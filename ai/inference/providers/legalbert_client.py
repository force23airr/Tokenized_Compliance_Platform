"""
Legal-BERT Client for Document Classification and Entity Extraction

This module provides a preprocessing layer that uses Legal-BERT to:
1. Classify document types (PPM, Form D, exemption filing, etc.)
2. Extract legal entities (issuer names, jurisdictions, regulation references)
3. Tag legal context for downstream Mistral reasoning

Architecture:
    [Raw Document] → Legal-BERT → [Structured Legal Context] → Mistral → [Compliance Decision]
"""

import os
import re
import json
import logging
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

# Try to import transformers - graceful fallback if not installed
try:
    import torch
    from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("transformers not installed - Legal-BERT will use rule-based fallback")


class DocumentType(str, Enum):
    """Legal document type classifications"""
    FORM_D = "form_d"                        # SEC Form D filing
    FORM_S1 = "form_s1"                      # SEC Form S-1 registration
    PPM = "ppm"                              # Private Placement Memorandum
    SUBSCRIPTION_AGREEMENT = "subscription_agreement"
    ACCREDITATION_LETTER = "accreditation_letter"
    KYC_DOCUMENT = "kyc_document"
    EXEMPTION_FILING = "exemption_filing"
    PROSPECTUS = "prospectus"
    OPERATING_AGREEMENT = "operating_agreement"
    TERM_SHEET = "term_sheet"
    REGULATORY_FILING = "regulatory_filing"
    UNKNOWN = "unknown"


class RegulationType(str, Enum):
    """Regulatory framework references"""
    REG_D_506B = "reg_d_506b"
    REG_D_506C = "reg_d_506c"
    REG_S = "reg_s"
    REG_A_PLUS = "reg_a_plus"
    RULE_144 = "rule_144"
    RULE_144A = "rule_144a"
    MIFID_II = "mifid_ii"
    SFA_275 = "sfa_275"
    SFA_305 = "sfa_305"
    MAS_CIRCULAR = "mas_circular"
    FCA_COBS = "fca_cobs"
    UNKNOWN = "unknown"


@dataclass
class LegalEntity:
    """Extracted legal entity from document"""
    entity_type: str          # issuer, investor, custodian, regulator, law_firm
    name: str
    jurisdiction: Optional[str] = None
    identifier: Optional[str] = None  # EIN, CRD, registration number
    confidence: float = 0.0


@dataclass
class RegulationReference:
    """Reference to a specific regulation or rule"""
    regulation_type: RegulationType
    full_reference: str       # "Rule 506(c) of Regulation D"
    section: Optional[str] = None
    jurisdiction: str = "US"
    confidence: float = 0.0


@dataclass
class LegalClause:
    """Important legal clause or provision"""
    clause_type: str          # lockup, accreditation, transfer_restriction, disclosure
    text_snippet: str
    relevance_score: float = 0.0


@dataclass
class LegalDocumentAnalysis:
    """Complete analysis result from Legal-BERT"""
    document_type: DocumentType
    document_type_confidence: float

    # Extracted entities
    entities: List[LegalEntity] = field(default_factory=list)

    # Regulation references found
    regulations: List[RegulationReference] = field(default_factory=list)

    # Key clauses identified
    key_clauses: List[LegalClause] = field(default_factory=list)

    # Jurisdiction tags
    jurisdictions: List[str] = field(default_factory=list)

    # Summary for Mistral context
    structured_summary: Dict[str, Any] = field(default_factory=dict)

    # Processing metadata
    model_used: str = "rule-based-fallback"
    processing_time_ms: float = 0.0


class LegalBertClient:
    """
    Legal-BERT client for document preprocessing.

    Uses nlpaueb/legal-bert-base-uncased for:
    - Document type classification
    - Named entity recognition (legal entities)
    - Regulation reference extraction

    Falls back to rule-based extraction if transformers not available.
    """

    MODEL_NAME = "nlpaueb/legal-bert-base-uncased"
    MAX_LENGTH = 512

    # Document type keywords for rule-based fallback
    DOC_TYPE_PATTERNS = {
        DocumentType.FORM_D: [
            r"form\s*d", r"notice\s+of\s+exempt\s+offering", r"regulation\s+d\s+filing"
        ],
        DocumentType.FORM_S1: [
            r"form\s*s-?1", r"registration\s+statement", r"securities\s+act\s+of\s+1933"
        ],
        DocumentType.PPM: [
            r"private\s+placement\s+memorandum", r"ppm", r"confidential\s+offering"
        ],
        DocumentType.SUBSCRIPTION_AGREEMENT: [
            r"subscription\s+agreement", r"subscription\s+form", r"investor\s+subscription"
        ],
        DocumentType.ACCREDITATION_LETTER: [
            r"accredited\s+investor", r"accreditation\s+letter", r"verification\s+letter"
        ],
        DocumentType.PROSPECTUS: [
            r"prospectus", r"offering\s+circular"
        ],
        DocumentType.EXEMPTION_FILING: [
            r"exemption\s+filing", r"notice\s+filing", r"blue\s+sky"
        ],
    }

    # Regulation patterns
    REGULATION_PATTERNS = {
        RegulationType.REG_D_506B: [
            r"rule\s+506\(b\)", r"regulation\s+d.*506\(b\)", r"506\(b\)\s+offering"
        ],
        RegulationType.REG_D_506C: [
            r"rule\s+506\(c\)", r"regulation\s+d.*506\(c\)", r"506\(c\)\s+offering"
        ],
        RegulationType.REG_S: [
            r"regulation\s+s", r"reg\.?\s*s", r"offshore\s+offering"
        ],
        RegulationType.REG_A_PLUS: [
            r"regulation\s+a\+?", r"reg\.?\s*a\+?", r"mini-ipo"
        ],
        RegulationType.RULE_144: [
            r"rule\s+144(?!\s*a)", r"holding\s+period.*restricted"
        ],
        RegulationType.RULE_144A: [
            r"rule\s+144a", r"144a\s+offering", r"qib\s+only"
        ],
        RegulationType.MIFID_II: [
            r"mifid\s*(ii|2)", r"markets\s+in\s+financial\s+instruments"
        ],
        RegulationType.SFA_275: [
            r"section\s+275", r"sfa\s+275", r"accredited\s+investor.*singapore"
        ],
        RegulationType.FCA_COBS: [
            r"fca\s+cobs", r"conduct\s+of\s+business\s+sourcebook"
        ],
    }

    # Jurisdiction patterns
    JURISDICTION_PATTERNS = {
        "US": [r"\busa?\b", r"united\s+states", r"\bsec\b", r"delaware", r"new\s+york"],
        "UK": [r"\bu\.?k\.?\b", r"united\s+kingdom", r"\bfca\b", r"england", r"companies\s+house"],
        "SG": [r"singapore", r"\bmas\b", r"\bacra\b", r"sfa"],
        "EU": [r"\besma\b", r"european\s+union", r"mifid", r"luxembourg", r"ireland"],
        "KY": [r"cayman", r"\bcima\b", r"exempted\s+company"],
        "BVI": [r"british\s+virgin", r"\bbvi\b"],
        "HK": [r"hong\s+kong", r"\bsfc\b"],
    }

    def __init__(
        self,
        use_gpu: bool = True,
        load_model: bool = True
    ):
        self.device = "cuda" if use_gpu and torch.cuda.is_available() else "cpu" if TRANSFORMERS_AVAILABLE else None
        self.tokenizer = None
        self.model = None
        self.model_loaded = False

        if load_model and TRANSFORMERS_AVAILABLE:
            self._load_model()

    def _load_model(self):
        """Load Legal-BERT model and tokenizer"""
        try:
            logger.info(f"Loading Legal-BERT model: {self.MODEL_NAME}")
            self.tokenizer = AutoTokenizer.from_pretrained(self.MODEL_NAME)
            self.model = AutoModel.from_pretrained(self.MODEL_NAME)

            if self.device == "cuda":
                self.model = self.model.to(self.device)

            self.model.eval()
            self.model_loaded = True
            logger.info(f"Legal-BERT loaded successfully on {self.device}")

        except Exception as e:
            logger.error(f"Failed to load Legal-BERT: {e}")
            self.model_loaded = False

    def analyze_document(self, text: str) -> LegalDocumentAnalysis:
        """
        Analyze a legal document and extract structured information.

        Args:
            text: Raw document text

        Returns:
            LegalDocumentAnalysis with document type, entities, regulations, etc.
        """
        import time
        start_time = time.time()

        # Normalize text
        text_lower = text.lower()
        text_clean = re.sub(r'\s+', ' ', text).strip()

        # Classify document type
        doc_type, doc_confidence = self._classify_document_type(text_lower)

        # Extract entities
        entities = self._extract_entities(text_clean)

        # Extract regulation references
        regulations = self._extract_regulations(text_lower)

        # Extract key clauses
        key_clauses = self._extract_key_clauses(text_clean)

        # Detect jurisdictions
        jurisdictions = self._detect_jurisdictions(text_lower)

        # Build structured summary for Mistral
        structured_summary = self._build_summary(
            doc_type, entities, regulations, key_clauses, jurisdictions
        )

        processing_time = (time.time() - start_time) * 1000

        return LegalDocumentAnalysis(
            document_type=doc_type,
            document_type_confidence=doc_confidence,
            entities=entities,
            regulations=regulations,
            key_clauses=key_clauses,
            jurisdictions=jurisdictions,
            structured_summary=structured_summary,
            model_used="legal-bert" if self.model_loaded else "rule-based-fallback",
            processing_time_ms=processing_time
        )

    def _classify_document_type(self, text: str) -> Tuple[DocumentType, float]:
        """Classify document type using patterns or model"""

        # Use pattern matching (works with or without model)
        scores = {}
        for doc_type, patterns in self.DOC_TYPE_PATTERNS.items():
            score = 0
            for pattern in patterns:
                matches = len(re.findall(pattern, text, re.IGNORECASE))
                score += matches
            if score > 0:
                scores[doc_type] = score

        if scores:
            best_type = max(scores, key=scores.get)
            # Normalize confidence
            total = sum(scores.values())
            confidence = scores[best_type] / total if total > 0 else 0.5
            return best_type, min(confidence, 0.95)

        return DocumentType.UNKNOWN, 0.0

    def _extract_entities(self, text: str) -> List[LegalEntity]:
        """Extract legal entities from text"""
        entities = []

        # Issuer patterns
        issuer_patterns = [
            r"(?:the\s+)?(?:issuer|company|fund)(?:\s+is)?\s*[:\-]?\s*([A-Z][A-Za-z\s,\.]+(?:LLC|Inc|Corp|LP|LLP|Ltd))",
            r"([A-Z][A-Za-z\s]+(?:Capital|Partners|Fund|Holdings|Investments)\s*(?:LLC|LP|Inc)?)",
        ]
        for pattern in issuer_patterns:
            for match in re.finditer(pattern, text):
                name = match.group(1).strip()
                if len(name) > 3 and len(name) < 100:
                    entities.append(LegalEntity(
                        entity_type="issuer",
                        name=name,
                        confidence=0.7
                    ))

        # Custodian patterns
        custodian_patterns = [
            r"custodian[:\s]+([A-Z][A-Za-z\s]+(?:Bank|Trust|Custody))",
        ]
        for pattern in custodian_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                entities.append(LegalEntity(
                    entity_type="custodian",
                    name=match.group(1).strip(),
                    confidence=0.8
                ))

        # Law firm patterns
        law_firm_patterns = [
            r"([A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)+\s*(?:LLP|P\.?C\.?))",
        ]
        for pattern in law_firm_patterns:
            for match in re.finditer(pattern, text):
                entities.append(LegalEntity(
                    entity_type="law_firm",
                    name=match.group(1).strip(),
                    confidence=0.7
                ))

        # Deduplicate
        seen = set()
        unique_entities = []
        for e in entities:
            key = (e.entity_type, e.name.lower())
            if key not in seen:
                seen.add(key)
                unique_entities.append(e)

        return unique_entities[:10]  # Limit to top 10

    def _extract_regulations(self, text: str) -> List[RegulationReference]:
        """Extract regulation references from text"""
        regulations = []

        for reg_type, patterns in self.REGULATION_PATTERNS.items():
            for pattern in patterns:
                for match in re.finditer(pattern, text, re.IGNORECASE):
                    # Determine jurisdiction from regulation type
                    jurisdiction = "US"
                    if reg_type in [RegulationType.MIFID_II]:
                        jurisdiction = "EU"
                    elif reg_type in [RegulationType.SFA_275, RegulationType.SFA_305]:
                        jurisdiction = "SG"
                    elif reg_type == RegulationType.FCA_COBS:
                        jurisdiction = "UK"

                    regulations.append(RegulationReference(
                        regulation_type=reg_type,
                        full_reference=match.group(0),
                        jurisdiction=jurisdiction,
                        confidence=0.85
                    ))

        # Deduplicate
        seen = set()
        unique_regs = []
        for r in regulations:
            if r.regulation_type not in seen:
                seen.add(r.regulation_type)
                unique_regs.append(r)

        return unique_regs

    def _extract_key_clauses(self, text: str) -> List[LegalClause]:
        """Extract important legal clauses"""
        clauses = []

        clause_patterns = {
            "lockup": [
                r"(?:lock-?up|holding)\s+period.*?(?:\d+\s*(?:day|month|year)s?)",
                r"restricted\s+from\s+(?:sale|transfer).*?(?:\d+\s*(?:day|month|year)s?)",
            ],
            "accreditation": [
                r"accredited\s+investor.*?(?:income|net\s+worth|professional)",
                r"qualified\s+purchaser.*?(?:investment|assets)",
            ],
            "transfer_restriction": [
                r"transfer.*?(?:prohibited|restricted|limited).*?(?:without|unless)",
                r"may\s+not\s+(?:sell|transfer|assign).*?(?:consent|approval)",
            ],
            "minimum_investment": [
                r"minimum\s+(?:investment|subscription).*?\$[\d,]+",
            ],
        }

        for clause_type, patterns in clause_patterns.items():
            for pattern in patterns:
                for match in re.finditer(pattern, text, re.IGNORECASE):
                    snippet = match.group(0)[:200]  # Limit snippet length
                    clauses.append(LegalClause(
                        clause_type=clause_type,
                        text_snippet=snippet,
                        relevance_score=0.75
                    ))

        return clauses[:10]  # Limit to top 10

    def _detect_jurisdictions(self, text: str) -> List[str]:
        """Detect mentioned jurisdictions"""
        found = set()

        for jurisdiction, patterns in self.JURISDICTION_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    found.add(jurisdiction)

        return sorted(list(found))

    def _build_summary(
        self,
        doc_type: DocumentType,
        entities: List[LegalEntity],
        regulations: List[RegulationReference],
        clauses: List[LegalClause],
        jurisdictions: List[str]
    ) -> Dict[str, Any]:
        """Build structured summary for Mistral context"""

        # Get primary issuer
        issuer = next(
            (e for e in entities if e.entity_type == "issuer"),
            None
        )

        # Get primary regulations
        primary_regs = [r.regulation_type.value for r in regulations[:3]]

        # Get key restrictions
        restrictions = []
        for c in clauses:
            if c.clause_type in ["lockup", "transfer_restriction"]:
                restrictions.append(c.text_snippet[:100])

        return {
            "document_type": doc_type.value,
            "issuer_name": issuer.name if issuer else None,
            "jurisdictions": jurisdictions,
            "applicable_regulations": primary_regs,
            "has_lockup_provision": any(c.clause_type == "lockup" for c in clauses),
            "has_accreditation_requirement": any(c.clause_type == "accreditation" for c in clauses),
            "has_transfer_restrictions": any(c.clause_type == "transfer_restriction" for c in clauses),
            "entity_count": len(entities),
            "regulation_count": len(regulations),
            "key_restrictions": restrictions[:3],
        }

    def get_embeddings(self, text: str) -> Optional[List[float]]:
        """
        Get Legal-BERT embeddings for text.
        Useful for semantic similarity and clustering.
        """
        if not self.model_loaded:
            return None

        try:
            inputs = self.tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=self.MAX_LENGTH,
                padding=True
            )

            if self.device == "cuda":
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = self.model(**inputs)
                # Use CLS token embedding
                embeddings = outputs.last_hidden_state[:, 0, :].squeeze()

            return embeddings.cpu().tolist()

        except Exception as e:
            logger.error(f"Failed to get embeddings: {e}")
            return None


# Singleton instance
_client: Optional[LegalBertClient] = None


def get_client(load_model: bool = True) -> LegalBertClient:
    """Get or create the singleton Legal-BERT client"""
    global _client
    if _client is None:
        _client = LegalBertClient(load_model=load_model)
    return _client


def analyze_document(text: str) -> LegalDocumentAnalysis:
    """Convenience function for document analysis"""
    client = get_client()
    return client.analyze_document(text)


def get_structured_context(text: str) -> Dict[str, Any]:
    """Get structured context for Mistral prompt enhancement"""
    analysis = analyze_document(text)
    return analysis.structured_summary
