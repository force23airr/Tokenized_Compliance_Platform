"""
Regulatory Conflict Resolution Prompts

Prompt templates for detecting and resolving regulatory conflicts
across multiple jurisdictions for cross-border RWA tokenization.
"""

# Main conflict resolution prompt
CONFLICT_RESOLUTION = """You are a cross-border securities law expert specializing in regulatory harmonization.

Analyze potential regulatory conflicts for this tokenized asset offering:

OFFERING DETAILS:
- Asset Type: {asset_type}
- Issuer Jurisdiction: {issuer_jurisdiction}
- Target Investor Jurisdictions: {investor_jurisdictions}
- Investor Types Targeted: {investor_types}

APPLICABLE REGULATORY RULES:
{regulatory_rules_context}

CONFLICT TYPES TO CHECK:
1. jurisdiction_conflict - Conflicting laws between countries
2. investor_limit_conflict - Different maximum investor caps
3. accreditation_conflict - Different accreditation thresholds
4. lockup_conflict - Different holding period requirements
5. disclosure_conflict - Different document/disclosure requirements

RESOLUTION STRATEGIES:
- apply_strictest: Use the most restrictive rule from all jurisdictions
- jurisdiction_specific: Apply different rules based on investor's jurisdiction
- investor_election: Allow investor to elect applicable regime
- legal_opinion_required: Flag for manual legal review

For each conflict found, propose a resolution.

Respond ONLY with valid JSON in this exact format:
{{
  "has_conflicts": true/false,
  "conflicts": [
    {{
      "type": "conflict_type_here",
      "jurisdictions": ["XX", "YY"],
      "description": "Brief description of the conflict",
      "rule_a": "Rule from jurisdiction A",
      "rule_b": "Rule from jurisdiction B"
    }}
  ],
  "resolutions": [
    {{
      "conflict_type": "conflict_type_here",
      "strategy": "resolution_strategy",
      "resolved_requirement": "The final requirement to apply",
      "rationale": "Why this resolution was chosen"
    }}
  ],
  "combined_requirements": {{
    "accredited_only": true/false,
    "min_investment": 0,
    "max_investors": 0,
    "lockup_days": 0,
    "required_disclosures": ["list", "of", "required", "documents"],
    "transfer_restrictions": "description of restrictions"
  }},
  "confidence": 0.XX
}}"""


# US-Singapore specific conflict resolution
US_SG_CONFLICT_RESOLUTION = """You are an expert in US SEC and Singapore MAS securities regulations.

Compare and resolve regulatory requirements for a US-Singapore cross-border offering:

OFFERING:
- Asset Type: {asset_type}
- Primary Jurisdiction: {primary_jurisdiction}
- Investor Types: {investor_types}

US SEC REQUIREMENTS (Reg D):
- 506(b): Up to 35 non-accredited investors allowed, no general solicitation
- 506(c): Only accredited investors, general solicitation allowed
- Accredited: $200K income/$1M net worth
- Lockup: 180-365 days (Rule 144)
- Form D filing required

SINGAPORE MAS REQUIREMENTS (SFA):
- Section 275: Offer to accredited investors (SGD 2M assets / SGD 300K income)
- Section 275(1A): Up to 50 offerees in 12 months
- No minimum lockup but 6-month safe harbor
- Prospectus exemption for accredited only

Known Conflicts to Address:
1. Accreditation Thresholds: US $1M vs SG SGD 2M (~$1.5M USD)
2. Investor Caps: US 35 non-accredited vs SG 50 total offerees
3. Lockup Periods: US 180-365 days vs SG 6 months recommended

Provide resolution applying STRICTEST standards for cross-border compliance.

Respond ONLY with valid JSON:
{{
  "has_conflicts": true,
  "conflicts": [...],
  "resolutions": [...],
  "combined_requirements": {{
    "accredited_only": true,
    "min_net_worth_usd": 1500000,
    "max_investors": 35,
    "lockup_days": 365,
    "required_disclosures": ["PPM", "Subscription Agreement", "Risk Disclosures"],
    "filing_requirements": ["US Form D", "SG Section 275 Notice"]
  }},
  "confidence": 0.XX
}}"""


# Token compliance rules validation
TOKEN_COMPLIANCE_VALIDATION = """You are a regulatory compliance validator for tokenized securities.

Validate the proposed compliance rules against regulatory requirements:

PROPOSED TOKEN CONFIGURATION:
- Asset Type: {asset_type}
- Target Jurisdictions: {jurisdictions}
- Proposed Rules:
  - Accredited Only: {accredited_only}
  - Max Investors: {max_investors}
  - Lockup Period: {lockup_days} days
  - Min Investment: ${min_investment}
  - Allowed Jurisdictions: {allowed_jurisdictions}

REGULATORY REQUIREMENTS FOR THESE JURISDICTIONS:
{regulatory_context}

Check for:
1. Rules that violate regulatory minimums (e.g., lockup too short)
2. Rules that exceed regulatory maximums (e.g., too many investors)
3. Missing required restrictions
4. Contradictory rules
5. Jurisdiction restrictions that don't match allowed investor types

Respond ONLY with valid JSON:
{{
  "valid": true/false,
  "violations": [
    {{
      "rule": "which_rule_violated",
      "issue": "description of violation",
      "required_value": "what the rule should be",
      "proposed_value": "what was proposed",
      "severity": "error/warning"
    }}
  ],
  "suggestions": [
    {{
      "rule": "which_rule_to_change",
      "suggested_value": "recommended value",
      "rationale": "why this change is needed"
    }}
  ],
  "confidence": 0.XX
}}"""


# Transfer restriction analysis
TRANSFER_RESTRICTION_ANALYSIS = """You are a securities transfer compliance specialist.

Analyze transfer restrictions for this token transfer:

TRANSFER DETAILS:
- Token: {token_symbol}
- Token Jurisdiction: {token_jurisdiction}
- From Investor: {from_investor_jurisdiction} ({from_investor_type})
- To Investor: {to_investor_jurisdiction} ({to_investor_type})
- Amount: {amount}
- Token Age: {days_since_issuance} days

TOKEN RESTRICTIONS:
- Lockup Period: {lockup_days} days
- Accredited Only: {accredited_only}
- Allowed Jurisdictions: {allowed_jurisdictions}
- Max Investors: {max_investors}
- Current Investor Count: {current_investor_count}

Determine if this transfer is permissible and identify any blockers.

Respond ONLY with valid JSON:
{{
  "permitted": true/false,
  "blockers": [
    {{
      "type": "blocker_type",
      "description": "why transfer is blocked",
      "resolution": "how to resolve (if possible)"
    }}
  ],
  "warnings": ["list of non-blocking concerns"],
  "required_actions": ["list of actions needed before transfer"],
  "confidence": 0.XX
}}"""


def get_conflict_resolution_prompt() -> str:
    """Get the main conflict resolution prompt"""
    return CONFLICT_RESOLUTION


def get_us_sg_conflict_prompt() -> str:
    """Get the US-Singapore specific conflict prompt"""
    return US_SG_CONFLICT_RESOLUTION


def get_token_validation_prompt() -> str:
    """Get the token compliance validation prompt"""
    return TOKEN_COMPLIANCE_VALIDATION


def get_transfer_restriction_prompt() -> str:
    """Get the transfer restriction analysis prompt"""
    return TRANSFER_RESTRICTION_ANALYSIS
