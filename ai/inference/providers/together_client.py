"""
Together.ai API Client for Mistral Inference

This module provides an async client for calling Together.ai's inference API
with Mistral-7B-Instruct for compliance classification and conflict resolution.
"""

import os
import json
import httpx
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class ConflictType(str, Enum):
    """Typed conflict categories for analytics and auditing"""
    JURISDICTION_CONFLICT = "jurisdiction_conflict"
    INVESTOR_LIMIT_CONFLICT = "investor_limit_conflict"
    ACCREDITATION_CONFLICT = "accreditation_conflict"
    LOCKUP_CONFLICT = "lockup_conflict"
    DISCLOSURE_CONFLICT = "disclosure_conflict"


@dataclass
class JurisdictionResult:
    """Result from jurisdiction classification"""
    jurisdiction: str
    entity_type: str
    investor_classification: str
    applicable_regulations: List[str]
    confidence: float
    reasoning: Optional[str] = None


@dataclass
class Conflict:
    """A single regulatory conflict between jurisdictions"""
    conflict_type: ConflictType
    jurisdictions: List[str]
    description: str
    rule_a: str
    rule_b: str


@dataclass
class Resolution:
    """Resolution for a regulatory conflict"""
    conflict_type: ConflictType
    strategy: str  # apply_strictest, jurisdiction_specific, investor_election, legal_opinion_required
    resolved_requirement: str
    rationale: str


@dataclass
class ConflictResult:
    """Result from conflict resolution"""
    has_conflicts: bool
    conflicts: List[Conflict]
    resolutions: List[Resolution]
    combined_requirements: Dict[str, Any]
    confidence: float
    ruleset_version: Optional[str] = None


@dataclass
class RegulatoryChangeProposal:
    """
    A specific, AI-proposed change to the ruleset.

    This is the output of the Regulatory Oracle - a structured proposal
    for modifying jurisdiction rules based on AI interpretation of
    regulatory updates.
    """
    is_relevant: bool
    confidence: float
    summary_of_change: str
    target_file: str  # e.g., "us_sec_rules.json"
    field_path: str   # e.g., "accredited_investor_definition.categories.natural_person_income.thresholds.individual_income"
    old_value: Any
    new_value: Any
    reasoning: str
    source_text: Optional[str] = None
    effective_date: Optional[str] = None
    requires_immediate_action: bool = False


class TogetherClient:
    """
    Async client for Together.ai inference API.

    Uses Mistral-7B-Instruct for regulatory compliance tasks.
    Includes retry logic, timeout handling, and fallback support.
    """

    DEFAULT_MODEL = "mistralai/Mistral-7B-Instruct-v0.2"
    DEFAULT_TIMEOUT = 30.0
    DEFAULT_MAX_RETRIES = 3

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES
    ):
        self.api_key = api_key or os.environ.get("TOGETHER_API_KEY")
        if not self.api_key:
            raise ValueError("TOGETHER_API_KEY environment variable or api_key parameter required")

        self.model = model or os.environ.get("TOGETHER_MODEL", self.DEFAULT_MODEL)
        self.base_url = "https://api.together.xyz/v1"
        self.timeout = timeout
        self.max_retries = max_retries
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the async HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
            )
        return self._client

    async def close(self):
        """Close the HTTP client connection"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def complete(
        self,
        prompt: str,
        max_tokens: int = 512,
        temperature: float = 0.1,
        stop: Optional[List[str]] = None,
        system_prompt: Optional[str] = None
    ) -> str:
        """
        Send a completion request to Together.ai.

        Args:
            prompt: The user prompt
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature (lower = more deterministic)
            stop: Stop sequences
            system_prompt: Optional system prompt for context

        Returns:
            The model's response text
        """
        client = await self._get_client()

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stop": stop or []
        }

        last_error = None
        for attempt in range(self.max_retries):
            try:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]

            except httpx.HTTPStatusError as e:
                last_error = e
                logger.warning(f"Together.ai request failed (attempt {attempt + 1}): {e}")
                if e.response.status_code == 429:  # Rate limited
                    import asyncio
                    await asyncio.sleep(2 ** attempt)  # Exponential backoff
                elif e.response.status_code >= 500:
                    import asyncio
                    await asyncio.sleep(1)  # Brief pause for server errors
                else:
                    raise

            except httpx.RequestError as e:
                last_error = e
                logger.warning(f"Together.ai connection error (attempt {attempt + 1}): {e}")
                import asyncio
                await asyncio.sleep(1)

        raise Exception(f"Together.ai request failed after {self.max_retries} attempts: {last_error}")

    async def classify_jurisdiction(
        self,
        document_text: str,
        document_type: str,
        prompt_template: str
    ) -> JurisdictionResult:
        """
        Classify investor jurisdiction and type from document.

        Args:
            document_text: The document content to analyze
            document_type: Type of document (passport, accreditation_letter, etc.)
            prompt_template: The prompt template to use

        Returns:
            JurisdictionResult with classification details
        """
        prompt = prompt_template.format(
            document_text=document_text,
            document_type=document_type
        )

        response_text = await self.complete(
            prompt=prompt,
            max_tokens=256,
            temperature=0.1
        )

        try:
            # Parse JSON response
            result = json.loads(response_text)
            return JurisdictionResult(
                jurisdiction=result.get("jurisdiction", "UNKNOWN"),
                entity_type=result.get("entity_type", "individual"),
                investor_classification=result.get("investor_classification", "retail"),
                applicable_regulations=result.get("applicable_regulations", []),
                confidence=result.get("confidence", 0.5),
                reasoning=result.get("reasoning")
            )
        except json.JSONDecodeError:
            logger.error(f"Failed to parse jurisdiction response: {response_text}")
            # Return low-confidence fallback
            return JurisdictionResult(
                jurisdiction="UNKNOWN",
                entity_type="individual",
                investor_classification="retail",
                applicable_regulations=[],
                confidence=0.0,
                reasoning="Failed to parse AI response"
            )

    async def resolve_conflicts(
        self,
        jurisdictions: List[str],
        asset_type: str,
        investor_types: List[str],
        regulatory_context: str,
        prompt_template: str,
        ruleset_version: Optional[str] = None
    ) -> ConflictResult:
        """
        Detect and resolve regulatory conflicts across jurisdictions.

        Args:
            jurisdictions: List of jurisdiction codes (e.g., ["US", "SG"])
            asset_type: Type of asset being tokenized
            investor_types: Types of investors targeted
            regulatory_context: JSON string of relevant rules
            prompt_template: The prompt template to use
            ruleset_version: Version of ruleset being used

        Returns:
            ConflictResult with conflicts, resolutions, and combined requirements
        """
        prompt = prompt_template.format(
            asset_type=asset_type,
            issuer_jurisdiction=jurisdictions[0] if jurisdictions else "US",
            investor_jurisdictions=", ".join(jurisdictions),
            investor_types=", ".join(investor_types),
            regulatory_rules_context=regulatory_context
        )

        response_text = await self.complete(
            prompt=prompt,
            max_tokens=1024,
            temperature=0.1
        )

        try:
            result = json.loads(response_text)

            # Parse conflicts with typed categories
            conflicts = []
            for c in result.get("conflicts", []):
                conflict_type = self._classify_conflict_type(c.get("type", ""))
                conflicts.append(Conflict(
                    conflict_type=conflict_type,
                    jurisdictions=c.get("jurisdictions", []),
                    description=c.get("description", ""),
                    rule_a=c.get("rule_a", ""),
                    rule_b=c.get("rule_b", "")
                ))

            # Parse resolutions
            resolutions = []
            for r in result.get("resolutions", []):
                conflict_type = self._classify_conflict_type(r.get("conflict_type", ""))
                resolutions.append(Resolution(
                    conflict_type=conflict_type,
                    strategy=r.get("strategy", "apply_strictest"),
                    resolved_requirement=r.get("resolved_requirement", ""),
                    rationale=r.get("rationale", "")
                ))

            return ConflictResult(
                has_conflicts=result.get("has_conflicts", False),
                conflicts=conflicts,
                resolutions=resolutions,
                combined_requirements=result.get("combined_requirements", {}),
                confidence=result.get("confidence", 0.8),
                ruleset_version=ruleset_version
            )

        except json.JSONDecodeError:
            logger.error(f"Failed to parse conflict response: {response_text}")
            # Return conservative fallback
            return ConflictResult(
                has_conflicts=True,
                conflicts=[],
                resolutions=[],
                combined_requirements={
                    "accredited_only": True,
                    "max_investors": 99,
                    "lockup_days": 365,
                    "requires_manual_review": True
                },
                confidence=0.0,
                ruleset_version=ruleset_version
            )

    def _classify_conflict_type(self, type_str: str) -> ConflictType:
        """Map conflict type string to enum"""
        type_lower = type_str.lower()

        if "jurisdiction" in type_lower:
            return ConflictType.JURISDICTION_CONFLICT
        elif "investor" in type_lower and ("limit" in type_lower or "cap" in type_lower):
            return ConflictType.INVESTOR_LIMIT_CONFLICT
        elif "accredit" in type_lower:
            return ConflictType.ACCREDITATION_CONFLICT
        elif "lockup" in type_lower or "holding" in type_lower:
            return ConflictType.LOCKUP_CONFLICT
        elif "disclosure" in type_lower or "document" in type_lower:
            return ConflictType.DISCLOSURE_CONFLICT
        else:
            return ConflictType.JURISDICTION_CONFLICT  # Default

    async def analyze_regulatory_impact(
        self,
        update_text: str,
        current_rules_context: Dict[str, Any],
        jurisdiction: str = "US"
    ) -> RegulatoryChangeProposal:
        """
        The Oracle Function: Analyzes regulatory text and proposes specific JSON updates.

        This is the core of the Regulatory Oracle system. It:
        1. Reads the raw regulatory update text
        2. Compares it against the current ruleset
        3. Identifies specific numeric/boolean changes
        4. Proposes a structured JSON patch

        Args:
            update_text: Raw text from regulatory update (SEC release, MAS circular, etc.)
            current_rules_context: Current jurisdiction rules as a dictionary
            jurisdiction: Target jurisdiction code (US, SG, EU, etc.)

        Returns:
            RegulatoryChangeProposal with specific field path and new value
        """
        # Flatten the current rules context for the prompt
        rules_str = json.dumps(current_rules_context, indent=2)

        # Determine target file based on jurisdiction
        jurisdiction_files = {
            "US": "us_sec_rules.json",
            "SG": "sg_mas_guidelines.json",
            "EU": "eu_mifid_ii.json",
            "GB": "eu_mifid_ii.json",
        }
        target_file = jurisdiction_files.get(jurisdiction.upper(), f"{jurisdiction.lower()}_rules.json")

        prompt = f"""TASK: You are a Senior Compliance Officer and Regulatory Expert. Analyze the following regulatory update text against our current JSON ruleset and determine if any specific values need to change.

CURRENT RULESET (JSON):
{rules_str}

NEW REGULATORY TEXT:
{update_text}

INSTRUCTIONS:
1. Carefully read the regulatory update and identify if it mandates a SPECIFIC change to any value in our ruleset.
2. Look for changes to:
   - Dollar thresholds (income limits, investment minimums, asset thresholds)
   - Time periods (holding periods, lockup days, filing deadlines)
   - Investor limits (max investors, caps)
   - Boolean flags (general solicitation allowed, accreditation required)
   - New exemption types or categories
3. If a change is needed, identify the EXACT dot-notation path to the JSON field.
4. Extract both the old value (from current rules) and the new value (from regulatory text).
5. Note if this requires immediate action or has a future effective date.

OUTPUT FORMAT (JSON ONLY - no markdown, no explanation outside JSON):
{{
    "is_relevant": true,
    "confidence": 0.95,
    "summary": "Brief description of the change",
    "target_field_path": "path.to.field.in.json",
    "old_value": <current value>,
    "new_value": <new value from regulation>,
    "reasoning": "Why this change is needed based on the regulatory text",
    "effective_date": "2025-01-01 or null if immediate",
    "requires_immediate_action": false
}}

If the regulatory text does NOT mandate a specific change to our ruleset values, respond with:
{{
    "is_relevant": false,
    "confidence": 0.9,
    "summary": "No actionable changes detected",
    "target_field_path": "",
    "old_value": null,
    "new_value": null,
    "reasoning": "Explain why no change is needed"
}}

IMPORTANT: Only propose changes for CONCRETE, SPECIFIC value modifications. Do not propose changes for:
- General guidance or interpretations
- Proposed rules (not yet final)
- Changes that don't affect numeric thresholds or boolean flags in our ruleset"""

        response_text = await self.complete(
            prompt=prompt,
            max_tokens=768,
            temperature=0.0  # Zero temperature for maximum precision
        )

        try:
            # Clean up potential markdown formatting from LLM
            cleaned_text = response_text.strip()
            if cleaned_text.startswith("```json"):
                cleaned_text = cleaned_text[7:]
            if cleaned_text.startswith("```"):
                cleaned_text = cleaned_text[3:]
            if cleaned_text.endswith("```"):
                cleaned_text = cleaned_text[:-3]
            cleaned_text = cleaned_text.strip()

            data = json.loads(cleaned_text)

            return RegulatoryChangeProposal(
                is_relevant=data.get("is_relevant", False),
                confidence=data.get("confidence", 0.0),
                summary_of_change=data.get("summary", ""),
                target_file=target_file,
                field_path=data.get("target_field_path", ""),
                old_value=data.get("old_value"),
                new_value=data.get("new_value"),
                reasoning=data.get("reasoning", ""),
                source_text=update_text[:500] if update_text else None,
                effective_date=data.get("effective_date"),
                requires_immediate_action=data.get("requires_immediate_action", False)
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse regulatory impact response: {e}\nResponse: {response_text}")
            return RegulatoryChangeProposal(
                is_relevant=False,
                confidence=0.0,
                summary_of_change="Parse error",
                target_file=target_file,
                field_path="",
                old_value=None,
                new_value=None,
                reasoning=f"Failed to parse AI response: {str(e)}",
                source_text=update_text[:500] if update_text else None
            )

    async def analyze_multiple_updates(
        self,
        updates: List[Dict[str, Any]],
        current_rules_context: Dict[str, Any],
        jurisdiction: str = "US"
    ) -> List[RegulatoryChangeProposal]:
        """
        Analyze multiple regulatory updates and return all proposals.

        Args:
            updates: List of update dicts with 'title', 'summary', 'raw_content' keys
            current_rules_context: Current jurisdiction rules
            jurisdiction: Target jurisdiction

        Returns:
            List of RegulatoryChangeProposal for all relevant updates
        """
        proposals = []

        for update in updates:
            # Combine title, summary, and raw content for analysis
            update_text = f"""
Title: {update.get('title', 'Unknown')}
Summary: {update.get('summary', '')}

Full Text:
{update.get('raw_content', update.get('summary', ''))}
"""
            proposal = await self.analyze_regulatory_impact(
                update_text=update_text,
                current_rules_context=current_rules_context,
                jurisdiction=jurisdiction
            )

            if proposal.is_relevant and proposal.confidence >= 0.7:
                proposals.append(proposal)
                logger.info(
                    f"Oracle found actionable change: {proposal.summary_of_change} "
                    f"(confidence: {proposal.confidence})"
                )

        return proposals


# Singleton instance for module-level usage
_client: Optional[TogetherClient] = None


def get_client() -> TogetherClient:
    """Get or create the singleton Together.ai client"""
    global _client
    if _client is None:
        _client = TogetherClient()
    return _client


async def cleanup():
    """Clean up the singleton client"""
    global _client
    if _client:
        await _client.close()
        _client = None
