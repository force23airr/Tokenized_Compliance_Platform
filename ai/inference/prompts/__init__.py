"""
AI Compliance Prompts

Prompt templates for regulatory compliance classification and conflict resolution.
"""

from .jurisdiction_prompts import (
    JURISDICTION_CLASSIFICATION,
    ACCREDITATION_ANALYSIS,
    ENTITY_CLASSIFICATION,
    KYC_DOCUMENT_ANALYSIS,
    SUITABILITY_ASSESSMENT,
    get_jurisdiction_prompt,
    get_accreditation_prompt,
    get_entity_prompt,
    get_kyc_prompt,
    get_suitability_prompt
)

from .conflict_prompts import (
    CONFLICT_RESOLUTION,
    US_SG_CONFLICT_RESOLUTION,
    TOKEN_COMPLIANCE_VALIDATION,
    TRANSFER_RESTRICTION_ANALYSIS,
    get_conflict_resolution_prompt,
    get_us_sg_conflict_prompt,
    get_token_validation_prompt,
    get_transfer_restriction_prompt
)

__all__ = [
    # Jurisdiction prompts
    "JURISDICTION_CLASSIFICATION",
    "ACCREDITATION_ANALYSIS",
    "ENTITY_CLASSIFICATION",
    "KYC_DOCUMENT_ANALYSIS",
    "SUITABILITY_ASSESSMENT",
    "get_jurisdiction_prompt",
    "get_accreditation_prompt",
    "get_entity_prompt",
    "get_kyc_prompt",
    "get_suitability_prompt",
    # Conflict prompts
    "CONFLICT_RESOLUTION",
    "US_SG_CONFLICT_RESOLUTION",
    "TOKEN_COMPLIANCE_VALIDATION",
    "TRANSFER_RESTRICTION_ANALYSIS",
    "get_conflict_resolution_prompt",
    "get_us_sg_conflict_prompt",
    "get_token_validation_prompt",
    "get_transfer_restriction_prompt"
]
