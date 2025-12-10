#!/usr/bin/env python3
"""
RWA Compliance AI - Inference API

FastAPI service for real-time compliance checks using a 2-model architecture:
    Legal-BERT (preprocessing) → Mistral (reasoning)

Legal-BERT: Document classification, entity extraction, legal context tagging
Mistral: Compliance reasoning, conflict resolution, regulatory interpretation
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

# Load environment variables from .env file
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import our modules
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from inference.providers.together_client import (
    TogetherClient,
    JurisdictionResult,
    ConflictResult,
    ConflictType,
    get_client,
    cleanup
)
from inference.providers.legalbert_client import (
    LegalBertClient,
    LegalDocumentAnalysis,
    DocumentType,
    get_client as get_legalbert_client,
    analyze_document as legalbert_analyze,
    get_structured_context
)

# Import Regulatory Oracle
try:
    from services.regulatory_oracle import (
        get_oracle,
        RegulatoryOracle,
        PendingChange,
        ChangeStatus
    )
    ORACLE_AVAILABLE = True
except ImportError:
    ORACLE_AVAILABLE = False
    logger.warning("Regulatory Oracle not available")
from inference.prompts import (
    JURISDICTION_CLASSIFICATION,
    ACCREDITATION_ANALYSIS,
    CONFLICT_RESOLUTION,
    TOKEN_COMPLIANCE_VALIDATION
)

app = FastAPI(
    title="RWA Compliance AI",
    description="""
AI-powered regulatory compliance for multi-jurisdiction tokenization.

**Architecture:**
- **Legal-BERT**: Document preprocessing (classification, entity extraction)
- **Mistral 7B**: Compliance reasoning (conflict resolution, regulatory interpretation)

The 2-model pipeline provides expert-level legal document understanding
combined with advanced reasoning capabilities.
    """,
    version="3.0.0"
)

# Configuration
CONFIDENCE_THRESHOLD = float(os.environ.get("AI_CONFIDENCE_THRESHOLD", "0.7"))
DATA_DIR = Path(__file__).parent.parent.parent / "data"
JURISDICTIONS_DIR = DATA_DIR / "jurisdictions"

# Cache for regulatory rules
_rules_cache: Dict[str, Dict] = {}
_rules_version: Dict[str, str] = {}


# ============== Request/Response Models ==============

class JurisdictionRequest(BaseModel):
    document_text: str
    document_type: str  # passport, incorporation_doc, tax_form, etc.

class JurisdictionResponse(BaseModel):
    jurisdiction: str
    entity_type: str
    investor_classification: str
    applicable_regulations: List[str]
    confidence: float
    requires_manual_review: bool = False
    reasoning: Optional[str] = None
    ruleset_version: Optional[str] = None

class DocumentAnalysisContext(BaseModel):
    """Context from Legal-BERT preprocessing (optional)"""
    document_type: str
    confidence: float
    regulations: List[str]
    jurisdictions: List[str]
    key_clauses: List[str]

class ConflictRequest(BaseModel):
    jurisdictions: List[str]
    asset_type: str
    investor_types: List[str]
    # Optional Legal-BERT context for 2-model pipeline
    legal_bert_context: Optional[str] = None
    document_analysis: Optional[DocumentAnalysisContext] = None

class ConflictResponse(BaseModel):
    has_conflicts: bool
    conflicts: List[dict]
    resolutions: List[dict]
    combined_requirements: dict
    confidence: float = 0.8
    requires_manual_review: bool = False
    ruleset_version: Optional[str] = None
    is_fallback: bool = False

class TokenValidationRequest(BaseModel):
    asset_type: str
    jurisdictions: List[str]
    compliance_rules: dict

class TokenValidationResponse(BaseModel):
    valid: bool
    violations: List[dict]
    suggestions: List[dict]
    confidence: float
    requires_manual_review: bool = False

class DocumentRequest(BaseModel):
    asset_type: str
    issuer_jurisdiction: str
    investor_jurisdictions: List[str]
    document_type: str  # subscription_agreement, ppm, disclosure
    custom_terms: Optional[dict] = None

class DocumentResponse(BaseModel):
    document_text: str
    applicable_regulations: List[str]
    warnings: List[str]


# ============== Legal-BERT Request/Response Models ==============

class LegalDocumentRequest(BaseModel):
    """Request for Legal-BERT document analysis"""
    document_text: str
    include_embeddings: bool = False

class LegalEntityResponse(BaseModel):
    entity_type: str
    name: str
    jurisdiction: Optional[str] = None
    identifier: Optional[str] = None
    confidence: float

class RegulationReferenceResponse(BaseModel):
    regulation_type: str
    full_reference: str
    section: Optional[str] = None
    jurisdiction: str
    confidence: float

class LegalClauseResponse(BaseModel):
    clause_type: str
    text_snippet: str
    relevance_score: float

class LegalDocumentResponse(BaseModel):
    """Response from Legal-BERT document analysis"""
    document_type: str
    document_type_confidence: float
    entities: List[LegalEntityResponse]
    regulations: List[RegulationReferenceResponse]
    key_clauses: List[LegalClauseResponse]
    jurisdictions: List[str]
    structured_summary: dict
    model_used: str
    processing_time_ms: float

class EnhancedComplianceRequest(BaseModel):
    """Request for 2-model pipeline (Legal-BERT + Mistral)"""
    document_text: str
    asset_type: str
    additional_jurisdictions: List[str] = []

class EnhancedComplianceResponse(BaseModel):
    """Response from 2-model pipeline"""
    # Legal-BERT analysis
    document_analysis: LegalDocumentResponse
    # Mistral compliance decision
    compliance_decision: dict
    # Combined result
    approved: bool
    confidence: float
    requires_manual_review: bool
    reasoning: str
    pipeline_version: str = "legal-bert-v1 + mistral-7b-v0.2"


# ============== Regulatory Rules Loading ==============

def load_jurisdiction_rules(jurisdiction: str) -> Dict:
    """Load regulatory rules for a jurisdiction from JSON file."""
    global _rules_cache, _rules_version

    if jurisdiction in _rules_cache:
        return _rules_cache[jurisdiction]

    # Map jurisdiction codes to file names
    file_mapping = {
        "US": "us_sec_rules.json",
        "SG": "sg_mas_guidelines.json",
        "EU": "eu_mifid_ii.json",
        "GB": "eu_mifid_ii.json",  # UK follows similar framework
    }

    filename = file_mapping.get(jurisdiction.upper())
    if not filename:
        logger.warning(f"No rules file for jurisdiction: {jurisdiction}")
        return {}

    file_path = JURISDICTIONS_DIR / filename
    if not file_path.exists():
        logger.warning(f"Rules file not found: {file_path}")
        return {}

    try:
        with open(file_path, 'r') as f:
            rules = json.load(f)
            _rules_cache[jurisdiction] = rules
            _rules_version[jurisdiction] = rules.get("version", f"{datetime.now().strftime('%Y.%m.%d')}.001")
            return rules
    except Exception as e:
        logger.error(f"Error loading rules for {jurisdiction}: {e}")
        return {}


def get_current_ruleset_version(jurisdictions: List[str]) -> str:
    """Get combined ruleset version for jurisdictions."""
    versions = []
    for jur in jurisdictions:
        load_jurisdiction_rules(jur)  # Ensure loaded
        if jur in _rules_version:
            versions.append(f"{jur}:{_rules_version[jur]}")
    return "|".join(versions) if versions else "unknown"


def build_regulatory_context(jurisdictions: List[str]) -> str:
    """Build regulatory context string from jurisdiction rules."""
    context_parts = []
    for jur in jurisdictions:
        rules = load_jurisdiction_rules(jur)
        if rules:
            # Extract key sections for context
            context = {
                "jurisdiction": jur,
                "exemptions": rules.get("exemptions", {}),
                "investor_definitions": rules.get("investor_definitions", {}),
                "transfer_restrictions": rules.get("transfer_restrictions", {}),
            }
            context_parts.append(f"{jur} Rules:\n{json.dumps(context, indent=2)[:2000]}")

    return "\n\n".join(context_parts) if context_parts else "No regulatory rules available."


# ============== Fallback Logic ==============

def fallback_classify_jurisdiction(request: JurisdictionRequest) -> JurisdictionResponse:
    """Fallback classification when AI is unavailable."""
    # Simple heuristic-based classification
    text_lower = request.document_text.lower()

    jurisdiction = "US"  # Default
    if "singapore" in text_lower or "sg" in text_lower:
        jurisdiction = "SG"
    elif "united kingdom" in text_lower or "uk" in text_lower:
        jurisdiction = "GB"

    return JurisdictionResponse(
        jurisdiction=jurisdiction,
        entity_type="individual",
        investor_classification="retail",  # Conservative default
        applicable_regulations=[],
        confidence=0.3,
        requires_manual_review=True,
        reasoning="Fallback classification - AI unavailable",
        ruleset_version=get_current_ruleset_version([jurisdiction])
    )


def fallback_resolve_conflicts(request: ConflictRequest) -> ConflictResponse:
    """Fallback conflict resolution when AI is unavailable."""
    # Apply strictest known rules
    return ConflictResponse(
        has_conflicts=True,
        conflicts=[{
            "type": ConflictType.JURISDICTION_CONFLICT.value,
            "jurisdictions": request.jurisdictions,
            "description": "Unable to analyze - applying strictest rules",
            "rule_a": "Unknown",
            "rule_b": "Unknown"
        }],
        resolutions=[{
            "conflict_type": ConflictType.JURISDICTION_CONFLICT.value,
            "strategy": "apply_strictest",
            "resolved_requirement": "Require accredited investors only with manual review",
            "rationale": "Fallback mode - conservative approach"
        }],
        combined_requirements={
            "accredited_only": True,
            "min_investment": 100000,
            "max_investors": 35,
            "lockup_days": 365,
            "required_disclosures": ["PPM", "Subscription Agreement", "Risk Disclosures"],
            "requires_manual_review": True
        },
        confidence=0.3,
        requires_manual_review=True,
        ruleset_version=get_current_ruleset_version(request.jurisdictions),
        is_fallback=True
    )


# ============== API Endpoints ==============

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    try:
        client = get_client()
        return {
            "status": "healthy",
            "ai_provider": "together.ai",
            "model": client.model,
            "confidence_threshold": CONFIDENCE_THRESHOLD,
            "rules_loaded": list(_rules_cache.keys())
        }
    except Exception as e:
        return {
            "status": "degraded",
            "error": str(e),
            "fallback_available": True
        }


@app.post("/classify-jurisdiction", response_model=JurisdictionResponse)
async def classify_jurisdiction(request: JurisdictionRequest):
    """
    Analyze investor documents to determine jurisdiction and classification.
    Uses Together.ai with Mistral for intelligent classification.
    """
    try:
        client = get_client()

        result = await client.classify_jurisdiction(
            document_text=request.document_text,
            document_type=request.document_type,
            prompt_template=JURISDICTION_CLASSIFICATION
        )

        # Check confidence threshold
        requires_manual_review = result.confidence < CONFIDENCE_THRESHOLD

        return JurisdictionResponse(
            jurisdiction=result.jurisdiction,
            entity_type=result.entity_type,
            investor_classification=result.investor_classification,
            applicable_regulations=result.applicable_regulations,
            confidence=result.confidence,
            requires_manual_review=requires_manual_review,
            reasoning=result.reasoning,
            ruleset_version=get_current_ruleset_version([result.jurisdiction])
        )

    except Exception as e:
        logger.error(f"Jurisdiction classification failed: {e}")
        return fallback_classify_jurisdiction(request)


@app.post("/resolve-conflicts", response_model=ConflictResponse)
async def resolve_conflicts(request: ConflictRequest):
    """
    Detect and resolve regulatory conflicts across jurisdictions.
    Uses Together.ai with Mistral for intelligent conflict analysis.

    When Legal-BERT context is provided (2-model pipeline), it enriches
    the prompt with structured document analysis for better reasoning.
    """
    try:
        client = get_client()

        # Merge jurisdictions from Legal-BERT analysis if provided
        all_jurisdictions = list(set(request.jurisdictions))
        if request.document_analysis:
            all_jurisdictions = list(set(
                request.jurisdictions + request.document_analysis.jurisdictions
            ))

        # Build regulatory context from loaded rules
        regulatory_context = build_regulatory_context(all_jurisdictions)
        ruleset_version = get_current_ruleset_version(all_jurisdictions)

        # Build enhanced context if Legal-BERT analysis is available
        enhanced_context = regulatory_context
        if request.legal_bert_context:
            enhanced_context = f"""## Legal-BERT Document Analysis:
{request.legal_bert_context}

## Regulatory Rules:
{regulatory_context}"""
            logger.info("Using 2-model pipeline with Legal-BERT context")

        # If document_analysis is provided, add structured info
        if request.document_analysis:
            doc_info = f"""
## Document Structure (from Legal-BERT):
- Document Type: {request.document_analysis.document_type} (confidence: {request.document_analysis.confidence:.2f})
- Applicable Regulations: {', '.join(request.document_analysis.regulations)}
- Detected Jurisdictions: {', '.join(request.document_analysis.jurisdictions)}
- Key Clauses: {', '.join(request.document_analysis.key_clauses[:5])}
"""
            enhanced_context = doc_info + "\n" + enhanced_context

        result = await client.resolve_conflicts(
            jurisdictions=all_jurisdictions,
            asset_type=request.asset_type,
            investor_types=request.investor_types,
            regulatory_context=enhanced_context,
            prompt_template=CONFLICT_RESOLUTION,
            ruleset_version=ruleset_version
        )

        # Check confidence threshold
        requires_manual_review = result.confidence < CONFIDENCE_THRESHOLD

        # Convert dataclasses to dicts for response
        conflicts = []
        for c in result.conflicts:
            conflicts.append({
                "type": c.conflict_type.value,
                "jurisdictions": c.jurisdictions,
                "description": c.description,
                "rule_a": c.rule_a,
                "rule_b": c.rule_b
            })

        resolutions = []
        for r in result.resolutions:
            resolutions.append({
                "conflict_type": r.conflict_type.value,
                "strategy": r.strategy,
                "resolved_requirement": r.resolved_requirement,
                "rationale": r.rationale
            })

        return ConflictResponse(
            has_conflicts=result.has_conflicts,
            conflicts=conflicts,
            resolutions=resolutions,
            combined_requirements=result.combined_requirements,
            confidence=result.confidence,
            requires_manual_review=requires_manual_review,
            ruleset_version=ruleset_version,
            is_fallback=False
        )

    except Exception as e:
        logger.error(f"Conflict resolution failed: {e}")
        return fallback_resolve_conflicts(request)


@app.post("/validate-token-compliance", response_model=TokenValidationResponse)
async def validate_token_compliance(request: TokenValidationRequest):
    """
    Validate proposed token compliance rules against regulatory requirements.
    """
    try:
        client = get_client()

        # Build context
        regulatory_context = build_regulatory_context(request.jurisdictions)

        prompt = TOKEN_COMPLIANCE_VALIDATION.format(
            asset_type=request.asset_type,
            jurisdictions=", ".join(request.jurisdictions),
            accredited_only=request.compliance_rules.get("accredited_only", True),
            max_investors=request.compliance_rules.get("max_investors", 2000),
            lockup_days=request.compliance_rules.get("lockup_period_days", 0),
            min_investment=request.compliance_rules.get("min_investment", 0),
            allowed_jurisdictions=", ".join(request.compliance_rules.get("allowed_jurisdictions", [])),
            regulatory_context=regulatory_context
        )

        response_text = await client.complete(
            prompt=prompt,
            max_tokens=512,
            temperature=0.1
        )

        try:
            result = json.loads(response_text)
            confidence = result.get("confidence", 0.8)

            return TokenValidationResponse(
                valid=result.get("valid", False),
                violations=result.get("violations", []),
                suggestions=result.get("suggestions", []),
                confidence=confidence,
                requires_manual_review=confidence < CONFIDENCE_THRESHOLD
            )
        except json.JSONDecodeError:
            logger.error(f"Failed to parse validation response: {response_text}")
            return TokenValidationResponse(
                valid=False,
                violations=[{"rule": "parse_error", "issue": "AI response could not be parsed"}],
                suggestions=[],
                confidence=0.0,
                requires_manual_review=True
            )

    except Exception as e:
        logger.error(f"Token validation failed: {e}")
        return TokenValidationResponse(
            valid=False,
            violations=[{"rule": "ai_error", "issue": str(e)}],
            suggestions=[],
            confidence=0.0,
            requires_manual_review=True
        )


@app.post("/generate-document", response_model=DocumentResponse)
async def generate_document(request: DocumentRequest):
    """
    Generate compliant documents for multi-jurisdiction offerings.
    """
    # Document generation requires more careful implementation
    # For now, return a placeholder with appropriate warnings
    return DocumentResponse(
        document_text="[Document generation requires legal review template integration]",
        applicable_regulations=["SEC Reg D", "MAS SFA"],
        warnings=[
            "Document generation is in preview mode",
            "All generated documents require legal review before use",
            "This is not legal advice"
        ]
    )


# ============== Legal-BERT Endpoints ==============

@app.post("/classify-legal-doc", response_model=LegalDocumentResponse)
async def classify_legal_document(request: LegalDocumentRequest):
    """
    Analyze a legal document using Legal-BERT.

    This endpoint performs:
    - Document type classification (Form D, PPM, etc.)
    - Entity extraction (issuers, custodians, law firms)
    - Regulation reference detection (Rule 506(c), Reg S, etc.)
    - Key clause identification (lockups, transfer restrictions)
    - Jurisdiction tagging

    Use this to preprocess documents before Mistral reasoning.
    """
    try:
        # Analyze with Legal-BERT
        analysis = legalbert_analyze(request.document_text)

        # Convert to response format
        entities = [
            LegalEntityResponse(
                entity_type=e.entity_type,
                name=e.name,
                jurisdiction=e.jurisdiction,
                identifier=e.identifier,
                confidence=e.confidence
            )
            for e in analysis.entities
        ]

        regulations = [
            RegulationReferenceResponse(
                regulation_type=r.regulation_type.value,
                full_reference=r.full_reference,
                section=r.section,
                jurisdiction=r.jurisdiction,
                confidence=r.confidence
            )
            for r in analysis.regulations
        ]

        key_clauses = [
            LegalClauseResponse(
                clause_type=c.clause_type,
                text_snippet=c.text_snippet,
                relevance_score=c.relevance_score
            )
            for c in analysis.key_clauses
        ]

        return LegalDocumentResponse(
            document_type=analysis.document_type.value,
            document_type_confidence=analysis.document_type_confidence,
            entities=entities,
            regulations=regulations,
            key_clauses=key_clauses,
            jurisdictions=analysis.jurisdictions,
            structured_summary=analysis.structured_summary,
            model_used=analysis.model_used,
            processing_time_ms=analysis.processing_time_ms
        )

    except Exception as e:
        logger.error(f"Legal-BERT analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Document analysis failed: {str(e)}")


@app.post("/analyze-compliance-pipeline", response_model=EnhancedComplianceResponse)
async def analyze_compliance_pipeline(request: EnhancedComplianceRequest):
    """
    Full 2-model compliance pipeline: Legal-BERT → Mistral.

    **Pipeline Flow:**
    1. Legal-BERT analyzes document structure, entities, and legal references
    2. Structured context is built from Legal-BERT output
    3. Mistral receives enriched prompt with legal context
    4. Mistral performs compliance reasoning and conflict resolution

    This provides the best of both models:
    - Legal-BERT: Expert legal document understanding
    - Mistral: Advanced regulatory reasoning
    """
    try:
        # Step 1: Legal-BERT preprocessing
        logger.info("Step 1: Running Legal-BERT analysis...")
        analysis = legalbert_analyze(request.document_text)

        # Step 2: Build enriched context for Mistral
        legal_context = analysis.structured_summary

        # Merge detected jurisdictions with additional ones
        all_jurisdictions = list(set(
            analysis.jurisdictions + request.additional_jurisdictions
        ))
        if not all_jurisdictions:
            all_jurisdictions = ["US"]  # Default

        # Step 3: Get regulatory rules
        regulatory_context = build_regulatory_context(all_jurisdictions)
        ruleset_version = get_current_ruleset_version(all_jurisdictions)

        # Step 4: Build enhanced prompt for Mistral
        enhanced_prompt = f"""You are analyzing a legal document for regulatory compliance.

## Document Analysis (from Legal-BERT preprocessing):
- Document Type: {legal_context.get('document_type', 'unknown')}
- Issuer: {legal_context.get('issuer_name', 'Not identified')}
- Detected Jurisdictions: {', '.join(analysis.jurisdictions)}
- Applicable Regulations: {', '.join(legal_context.get('applicable_regulations', []))}
- Has Lockup Provision: {legal_context.get('has_lockup_provision', False)}
- Has Accreditation Requirement: {legal_context.get('has_accreditation_requirement', False)}
- Has Transfer Restrictions: {legal_context.get('has_transfer_restrictions', False)}

## Asset Type: {request.asset_type}

## Regulatory Rules Context:
{regulatory_context}

## Task:
Based on the document analysis and regulatory context, provide a compliance assessment.
Determine if this offering complies with all applicable regulations.

Respond in JSON format:
{{
    "approved": true/false,
    "confidence": 0.0-1.0,
    "conflicts": [list of regulatory conflicts if any],
    "resolutions": [how to resolve each conflict],
    "requirements": {{
        "accredited_only": true/false,
        "max_investors": number,
        "lockup_days": number,
        "min_investment": number
    }},
    "reasoning": "explanation of the decision"
}}"""

        # Step 5: Call Mistral for reasoning
        logger.info("Step 2: Running Mistral compliance reasoning...")
        client = get_client()
        response_text = await client.complete(
            prompt=enhanced_prompt,
            max_tokens=1024,
            temperature=0.1
        )

        # Parse Mistral response
        try:
            compliance_decision = json.loads(response_text)
        except json.JSONDecodeError:
            logger.warning("Failed to parse Mistral JSON response, using fallback")
            compliance_decision = {
                "approved": False,
                "confidence": 0.5,
                "conflicts": [],
                "resolutions": [],
                "requirements": {
                    "accredited_only": True,
                    "max_investors": 99,
                    "lockup_days": 365,
                    "min_investment": 100000
                },
                "reasoning": response_text[:500]
            }

        # Step 6: Build response
        # Convert Legal-BERT analysis to response format
        entities = [
            LegalEntityResponse(
                entity_type=e.entity_type,
                name=e.name,
                jurisdiction=e.jurisdiction,
                identifier=e.identifier,
                confidence=e.confidence
            )
            for e in analysis.entities
        ]

        regulations = [
            RegulationReferenceResponse(
                regulation_type=r.regulation_type.value,
                full_reference=r.full_reference,
                section=r.section,
                jurisdiction=r.jurisdiction,
                confidence=r.confidence
            )
            for r in analysis.regulations
        ]

        key_clauses = [
            LegalClauseResponse(
                clause_type=c.clause_type,
                text_snippet=c.text_snippet,
                relevance_score=c.relevance_score
            )
            for c in analysis.key_clauses
        ]

        document_analysis = LegalDocumentResponse(
            document_type=analysis.document_type.value,
            document_type_confidence=analysis.document_type_confidence,
            entities=entities,
            regulations=regulations,
            key_clauses=key_clauses,
            jurisdictions=analysis.jurisdictions,
            structured_summary=analysis.structured_summary,
            model_used=analysis.model_used,
            processing_time_ms=analysis.processing_time_ms
        )

        # Combined confidence from both models
        combined_confidence = min(
            analysis.document_type_confidence,
            compliance_decision.get("confidence", 0.5)
        )

        return EnhancedComplianceResponse(
            document_analysis=document_analysis,
            compliance_decision=compliance_decision,
            approved=compliance_decision.get("approved", False),
            confidence=combined_confidence,
            requires_manual_review=combined_confidence < CONFIDENCE_THRESHOLD,
            reasoning=compliance_decision.get("reasoning", "No reasoning provided"),
            pipeline_version=f"legal-bert-{analysis.model_used} + mistral-7b-v0.2 | ruleset:{ruleset_version}"
        )

    except Exception as e:
        logger.error(f"Compliance pipeline failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Compliance pipeline failed: {str(e)}"
        )


@app.get("/models/status")
async def get_model_status():
    """Get status of all AI models in the pipeline."""
    legalbert_available = False
    legalbert_model = "rule-based-fallback"

    try:
        legalbert_client = get_legalbert_client(load_model=False)
        if legalbert_client.model_loaded:
            legalbert_available = True
            legalbert_model = legalbert_client.MODEL_NAME
        else:
            # Fallback mode is still "available" - just using rules instead of ML
            legalbert_available = True
            legalbert_model = "rule-based-fallback"
    except Exception as e:
        logger.warning(f"Legal-BERT status check failed: {e}")

    mistral_available = False
    mistral_model = "unknown"

    try:
        mistral_client = get_client()
        mistral_available = True
        mistral_model = mistral_client.model
    except Exception as e:
        logger.warning(f"Mistral status check failed: {e}")

    return {
        "pipeline": "legal-bert → mistral",
        "legal_bert": {
            "available": legalbert_available,
            "model": legalbert_model,
            "purpose": "Document classification, entity extraction, legal context"
        },
        "mistral": {
            "available": mistral_available,
            "model": mistral_model,
            "provider": "together.ai",
            "purpose": "Compliance reasoning, conflict resolution"
        },
        "oracle": {
            "available": ORACLE_AVAILABLE,
            "purpose": "Regulatory update analysis and granular rule patching"
        },
        "confidence_threshold": CONFIDENCE_THRESHOLD
    }


# ============== Regulatory Oracle Endpoints ==============

class OracleAnalysisRequest(BaseModel):
    """Request for Oracle to analyze a regulatory update"""
    update_text: str
    jurisdiction: str = "US"
    source_title: Optional[str] = None
    source_url: Optional[str] = None

class OracleAnalysisResponse(BaseModel):
    """Response from Oracle analysis"""
    status: str
    change_id: Optional[str] = None
    summary: Optional[str] = None
    field_path: Optional[str] = None
    old_value: Optional[Any] = None
    new_value: Optional[Any] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None

class PendingChangeResponse(BaseModel):
    """A pending change awaiting review"""
    id: str
    created_at: str
    jurisdiction: str
    status: str
    summary: str
    field_path: str
    old_value: Any
    new_value: Any
    confidence: float
    reasoning: str
    source_title: Optional[str] = None

class ApproveChangeRequest(BaseModel):
    """Request to approve a pending change"""
    reviewer: str
    notes: Optional[str] = None
    apply_immediately: bool = True

class RejectChangeRequest(BaseModel):
    """Request to reject a pending change"""
    reviewer: str
    reason: str


@app.post("/oracle/analyze", response_model=OracleAnalysisResponse)
async def oracle_analyze_update(request: OracleAnalysisRequest):
    """
    Submit a regulatory update for Oracle analysis.

    The Oracle will:
    1. Analyze the text using AI
    2. Identify specific rule changes needed
    3. Create a pending change proposal if relevant

    Returns the analysis result with change_id if a proposal was created.
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    try:
        oracle = get_oracle()
        source_update = {
            "title": request.source_title or "Manual submission",
            "url": request.source_url,
            "submitted_at": datetime.now().isoformat()
        }

        result = await oracle.process_update(
            update_text=request.update_text,
            jurisdiction=request.jurisdiction,
            source_update=source_update
        )

        return OracleAnalysisResponse(
            status=result.get("status", "error"),
            change_id=result.get("change_id"),
            summary=result.get("summary"),
            field_path=result.get("field_path"),
            old_value=result.get("old_value"),
            new_value=result.get("new_value"),
            confidence=result.get("confidence"),
            reason=result.get("reason")
        )

    except Exception as e:
        logger.error(f"Oracle analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/oracle/pending")
async def get_pending_changes(jurisdiction: Optional[str] = None):
    """
    Get all pending change proposals awaiting human review.

    Optionally filter by jurisdiction (US, SG, EU, etc.)
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    try:
        oracle = get_oracle()
        changes = oracle.get_pending_changes(jurisdiction)

        return {
            "count": len(changes),
            "changes": [
                {
                    "id": c.id,
                    "created_at": c.created_at,
                    "jurisdiction": c.jurisdiction,
                    "status": c.status.value,
                    "summary": c.proposal.get("summary", ""),
                    "field_path": c.proposal.get("field_path", ""),
                    "old_value": c.proposal.get("old_value"),
                    "new_value": c.proposal.get("new_value"),
                    "confidence": c.proposal.get("confidence", 0),
                    "reasoning": c.proposal.get("reasoning", ""),
                    "source_title": c.source_update.get("title") if c.source_update else None,
                    "requires_immediate_action": c.proposal.get("requires_immediate_action", False)
                }
                for c in changes
            ]
        }

    except Exception as e:
        logger.error(f"Failed to get pending changes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/oracle/pending/{change_id}")
async def get_pending_change_detail(change_id: str):
    """Get detailed information about a specific pending change."""
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    change = oracle.get_change_by_id(change_id)

    if not change:
        raise HTTPException(status_code=404, detail=f"Change {change_id} not found")

    return {
        "id": change.id,
        "created_at": change.created_at,
        "jurisdiction": change.jurisdiction,
        "status": change.status.value,
        "proposal": change.proposal,
        "source_update": change.source_update,
        "reviewed_by": change.reviewed_by,
        "reviewed_at": change.reviewed_at,
        "review_notes": change.review_notes,
        "applied_at": change.applied_at
    }


@app.post("/oracle/pending/{change_id}/approve")
async def approve_pending_change(change_id: str, request: ApproveChangeRequest):
    """
    Approve a pending change and optionally apply it immediately.

    This is the human-in-the-loop step where a compliance officer
    reviews and approves the AI-proposed rule change.
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    result = oracle.approve_change(
        change_id=change_id,
        reviewer=request.reviewer,
        notes=request.notes,
        apply_immediately=request.apply_immediately
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("reason"))

    logger.info(f"Change {change_id} approved by {request.reviewer}")
    return result


@app.post("/oracle/pending/{change_id}/reject")
async def reject_pending_change(change_id: str, request: RejectChangeRequest):
    """
    Reject a pending change with a reason.

    Rejected changes are preserved for audit purposes.
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    result = oracle.reject_change(
        change_id=change_id,
        reviewer=request.reviewer,
        reason=request.reason
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("reason"))

    logger.info(f"Change {change_id} rejected by {request.reviewer}: {request.reason}")
    return result


@app.get("/oracle/history/{jurisdiction}")
async def get_change_history(jurisdiction: str, limit: int = 20):
    """Get history of applied changes for a jurisdiction."""
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    history = oracle.get_change_history(jurisdiction.upper(), limit)

    return {
        "jurisdiction": jurisdiction.upper(),
        "count": len(history),
        "changes": history
    }


# ============== Impact Simulation - "God Mode" ==============

class SimulationRequest(BaseModel):
    """Request to run an impact simulation."""
    use_live_data: bool = False


@app.post("/oracle/pending/{change_id}/simulate")
async def run_impact_simulation(change_id: str, request: Optional[SimulationRequest] = None):
    """
    Run or re-run impact simulation for a pending change.

    This is the "God Mode" feature that shows exactly which investors
    would be affected by a proposed rule change BEFORE you approve it.

    Returns:
        - Casualty count and list
        - Total assets at risk
        - Severity level
        - Recommended grandfathering strategy
        - Warnings for high-impact changes
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    use_live = request.use_live_data if request else False

    oracle = get_oracle()
    result = await oracle.run_impact_simulation(change_id, use_live_data=use_live)

    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("reason"))

    return {
        "change_id": change_id,
        "simulation": result,
        "summary": {
            "severity": result.get("severity", "unknown"),
            "impacted_count": result.get("impacted_count", 0),
            "impact_percentage": result.get("impact_percentage", 0),
            "assets_at_risk_usd": result.get("total_assets_at_risk_usd", 0),
            "recommended_strategy": result.get("recommended_grandfathering", "unknown"),
            "warnings": result.get("warnings", [])
        }
    }


@app.get("/oracle/pending/{change_id}/impact")
async def get_impact_summary(change_id: str):
    """
    Get the impact simulation summary for a pending change.

    This returns the cached simulation result without re-running.
    Use POST /simulate to run a new simulation.
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    change = oracle.get_change_by_id(change_id)

    if not change:
        raise HTTPException(status_code=404, detail=f"Change {change_id} not found")

    simulation = change.impact_simulation

    if not simulation or simulation.get("error"):
        return {
            "change_id": change_id,
            "has_simulation": False,
            "message": "No simulation available. Use POST /simulate to run one.",
            "error": simulation.get("error") if simulation else None
        }

    # Extract key metrics for summary
    return {
        "change_id": change_id,
        "has_simulation": True,
        "summary": {
            "severity": simulation.get("severity", "unknown"),
            "impacted_count": simulation.get("impacted_count", 0),
            "total_investors_checked": simulation.get("total_investors_checked", 0),
            "impact_percentage": simulation.get("impact_percentage", 0),
            "assets_at_risk_usd": simulation.get("total_assets_at_risk_usd", 0),
            "assets_at_risk_percentage": simulation.get("assets_at_risk_percentage", 0),
            "recommended_strategy": simulation.get("recommended_grandfathering", "unknown"),
            "grandfathering_rationale": simulation.get("grandfathering_rationale", ""),
            "compliance_timeline_days": simulation.get("estimated_compliance_timeline_days", 0),
            "warnings_count": len(simulation.get("warnings", []))
        },
        "warnings": simulation.get("warnings", []),
        "impact_by_jurisdiction": simulation.get("impact_by_jurisdiction", {}),
        "simulated_at": simulation.get("simulated_at")
    }


@app.get("/oracle/pending/{change_id}/casualties")
async def get_casualties_list(change_id: str, limit: int = 50, offset: int = 0):
    """
    Get the detailed list of investors who would be affected by a pending change.

    These are the "casualties" - investors who would become non-compliant
    if the proposed rule change is approved.
    """
    if not ORACLE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Regulatory Oracle not available")

    oracle = get_oracle()
    change = oracle.get_change_by_id(change_id)

    if not change:
        raise HTTPException(status_code=404, detail=f"Change {change_id} not found")

    simulation = change.impact_simulation

    if not simulation or simulation.get("error"):
        return {
            "change_id": change_id,
            "has_casualties": False,
            "message": "No simulation available. Use POST /simulate to run one."
        }

    casualties = simulation.get("casualties", [])
    total = len(casualties)

    # Paginate
    paginated = casualties[offset:offset + limit]

    return {
        "change_id": change_id,
        "total_casualties": total,
        "returned": len(paginated),
        "offset": offset,
        "limit": limit,
        "casualties": paginated
    }


# ============== Startup/Shutdown ==============

@app.on_event("startup")
async def startup_event():
    """Initialize on startup."""
    logger.info("RWA Compliance AI starting...")

    # Pre-load jurisdiction rules
    for jur in ["US", "SG", "EU"]:
        load_jurisdiction_rules(jur)
        logger.info(f"Loaded rules for {jur}")

    # Verify Together.ai connection
    try:
        client = get_client()
        logger.info(f"Together.ai client initialized with model: {client.model}")
    except Exception as e:
        logger.warning(f"Together.ai client initialization failed: {e}")
        logger.info("Fallback mode will be used for requests")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("RWA Compliance AI shutting down...")
    await cleanup()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
