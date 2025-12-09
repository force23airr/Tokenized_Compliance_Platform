"""
Jurisdiction Classification Prompts

Prompt templates for classifying investor jurisdiction, entity type,
and accreditation status using Together.ai with Mistral.
"""

# Main jurisdiction classification prompt
JURISDICTION_CLASSIFICATION = """You are a securities regulation expert specializing in cross-border compliance.

Analyze the following {document_type} and classify the investor.

Document Content:
{document_text}

Based on the document, determine:
1. Primary jurisdiction (ISO 3166-1 alpha-2 code, e.g., "US", "SG", "GB")
2. Entity type: individual, corporation, llc, partnership, trust, or fund
3. Investor classification based on the jurisdiction:
   - For US: retail, accredited, qualified_purchaser, institutional
   - For Singapore: retail, accredited_investor, expert_investor, institutional_investor
   - For UK/EU: retail, professional, eligible_counterparty
4. List of applicable regulations

Respond ONLY with valid JSON in this exact format:
{{"jurisdiction": "XX", "entity_type": "...", "investor_classification": "...", "applicable_regulations": ["..."], "confidence": 0.XX, "reasoning": "..."}}"""


# Deep accreditation analysis prompt
ACCREDITATION_ANALYSIS = """You are a compliance expert for US SEC and Singapore MAS regulations.

Analyze this investor's accreditation status:

Investor Data:
- Claimed Jurisdiction: {jurisdiction}
- Investor Type: {investor_type}
- Claimed Status: {claimed_status}
- Verification Method: {verification_method}
- Supporting Data: {supporting_data}

VERIFICATION RULES:

For US investors (SEC Rule 501(a)):
- Individual income: $200K+ single (or $300K+ joint) for past 2 years with expectation of same
- Net worth: $1M+ excluding primary residence
- Professional licenses: Series 7, 65, or 82 holders
- Directors/executives of the issuer
- Knowledgeable employees of private funds

For Singapore investors (SFA Section 4A):
- Individual: Net personal assets exceeding SGD 2M OR income >= SGD 300K in preceding 12 months
- Corporation: Net assets exceeding SGD 10M
- Trustee of trust: Trust assets exceeding SGD 10M
- Accredited investor opting in with written consent

Analyze whether the provided data meets these requirements.

Respond ONLY with valid JSON:
{{"verified": true/false, "classification": "...", "requirements_met": ["..."], "requirements_missing": ["..."], "confidence": 0.XX, "notes": "..."}}"""


# Entity classification prompt for complex structures
ENTITY_CLASSIFICATION = """You are a securities compliance expert.

Classify this entity structure for RWA tokenization purposes:

Entity Information:
- Entity Name: {entity_name}
- Entity Type: {entity_type}
- Jurisdiction of Formation: {formation_jurisdiction}
- Beneficial Owners: {beneficial_owners}
- Control Person: {control_person}
- Business Description: {business_description}

Determine:
1. The appropriate investor classification
2. Whether look-through rules apply (for funds, trusts, special purpose vehicles)
3. Beneficial ownership disclosure requirements
4. Any enhanced due diligence requirements

Respond ONLY with valid JSON:
{{"classification": "...", "look_through_required": true/false, "beneficial_owners_count": X, "disclosure_requirements": ["..."], "enhanced_due_diligence": true/false, "reasoning": "...", "confidence": 0.XX}}"""


# KYC document analysis prompt
KYC_DOCUMENT_ANALYSIS = """You are a KYC/AML compliance specialist.

Analyze this KYC document for investor verification:

Document Type: {document_type}
Document Details: {document_details}
Issuing Authority: {issuing_authority}
Document Date: {document_date}

Verify:
1. Document authenticity indicators
2. Expiration status
3. Jurisdiction of issuance
4. Identity information extracted
5. Any red flags or anomalies

Respond ONLY with valid JSON:
{{"valid": true/false, "jurisdiction": "XX", "document_type": "...", "expiration_status": "valid/expired/near_expiry", "identity_info": {{"name": "...", "dob": "...", "id_number": "..."}}, "red_flags": ["..."], "confidence": 0.XX}}"""


# Investor suitability assessment prompt
SUITABILITY_ASSESSMENT = """You are an investment suitability expert.

Assess investor suitability for this RWA token:

Investor Profile:
- Classification: {investor_classification}
- Jurisdiction: {jurisdiction}
- Investment Experience: {experience_level}
- Risk Tolerance: {risk_tolerance}
- Investment Objectives: {objectives}

Token Profile:
- Asset Type: {asset_type}
- Risk Level: {token_risk_level}
- Minimum Investment: {min_investment}
- Lockup Period: {lockup_days} days
- Target Returns: {target_returns}

Assess whether this investment is suitable and identify any concerns.

Respond ONLY with valid JSON:
{{"suitable": true/false, "suitability_score": 0.XX, "concerns": ["..."], "recommendations": ["..."], "required_disclosures": ["..."], "confidence": 0.XX}}"""


def get_jurisdiction_prompt() -> str:
    """Get the main jurisdiction classification prompt"""
    return JURISDICTION_CLASSIFICATION


def get_accreditation_prompt() -> str:
    """Get the accreditation analysis prompt"""
    return ACCREDITATION_ANALYSIS


def get_entity_prompt() -> str:
    """Get the entity classification prompt"""
    return ENTITY_CLASSIFICATION


def get_kyc_prompt() -> str:
    """Get the KYC document analysis prompt"""
    return KYC_DOCUMENT_ANALYSIS


def get_suitability_prompt() -> str:
    """Get the suitability assessment prompt"""
    return SUITABILITY_ASSESSMENT
