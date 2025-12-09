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
