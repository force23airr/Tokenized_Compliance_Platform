#!/usr/bin/env python3
"""
RWA Compliance AI - Inference API
FastAPI service for real-time compliance checks using Together.ai.
"""

import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

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
from inference.prompts import (
    JURISDICTION_CLASSIFICATION,
    ACCREDITATION_ANALYSIS,
    CONFLICT_RESOLUTION,
    TOKEN_COMPLIANCE_VALIDATION
)

app = FastAPI(
    title="RWA Compliance AI",
    description="AI-powered regulatory compliance for multi-jurisdiction tokenization using Together.ai",
    version="2.0.0"
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

class ConflictRequest(BaseModel):
    jurisdictions: List[str]
    asset_type: str
    investor_types: List[str]

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
    """
    try:
        client = get_client()

        # Build regulatory context from loaded rules
        regulatory_context = build_regulatory_context(request.jurisdictions)
        ruleset_version = get_current_ruleset_version(request.jurisdictions)

        result = await client.resolve_conflicts(
            jurisdictions=request.jurisdictions,
            asset_type=request.asset_type,
            investor_types=request.investor_types,
            regulatory_context=regulatory_context,
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
