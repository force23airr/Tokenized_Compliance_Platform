"""
AI Inference Providers

This module provides clients for various AI inference APIs.

Architecture:
    Legal-BERT (preprocessing) → Mistral (reasoning)
"""

from .together_client import (
    TogetherClient,
    JurisdictionResult,
    ConflictResult,
    Conflict,
    Resolution,
    ConflictType,
    RegulatoryChangeProposal,
    get_client,
    cleanup
)

from .legalbert_client import (
    LegalBertClient,
    LegalDocumentAnalysis,
    DocumentType,
    RegulationType,
    LegalEntity,
    RegulationReference,
    LegalClause,
    get_client as get_legalbert_client,
    analyze_document,
    get_structured_context
)

__all__ = [
    # Together.ai / Mistral
    "TogetherClient",
    "JurisdictionResult",
    "ConflictResult",
    "Conflict",
    "Resolution",
    "ConflictType",
    "RegulatoryChangeProposal",
    "get_client",
    "cleanup",
    # Legal-BERT
    "LegalBertClient",
    "LegalDocumentAnalysis",
    "DocumentType",
    "RegulationType",
    "LegalEntity",
    "RegulationReference",
    "LegalClause",
    "get_legalbert_client",
    "analyze_document",
    "get_structured_context",
]
