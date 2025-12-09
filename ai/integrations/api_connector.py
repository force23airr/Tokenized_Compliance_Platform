"""
API Connector - Bridge between AI Compliance Engine and main backend API.

Handles:
- Authentication with main API
- Request/response formatting
- Retry logic and error handling
- Webhook callbacks for async processing
"""

import os
import httpx
import asyncio
from typing import Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class APIConfig:
    """Configuration for API connection."""
    base_url: str = os.getenv("RWA_API_URL", "http://localhost:3000/v1")
    api_key: str = os.getenv("RWA_API_KEY", "")
    timeout: int = 30
    max_retries: int = 3


class APIConnector:
    """
    Connector for RWA Platform main API.

    Used by AI services to:
    - Fetch investor data for compliance checks
    - Submit compliance decisions
    - Update investor whitelist status
    - Trigger smart contract updates
    """

    def __init__(self, config: Optional[APIConfig] = None):
        self.config = config or APIConfig()
        self.client = httpx.AsyncClient(
            base_url=self.config.base_url,
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
                "X-Service": "ai-compliance-engine"
            },
            timeout=self.config.timeout
        )

    async def get_investor(self, investor_id: str) -> Dict[str, Any]:
        """Fetch investor details for compliance processing."""
        response = await self._request("GET", f"/investors/{investor_id}")
        return response

    async def get_investor_documents(self, investor_id: str) -> Dict[str, Any]:
        """Fetch investor KYC documents for AI analysis."""
        response = await self._request("GET", f"/investors/{investor_id}/documents")
        return response

    async def submit_compliance_decision(
        self,
        investor_id: str,
        asset_id: str,
        decision: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Submit AI compliance decision for an investor-asset pair.

        Args:
            investor_id: The investor being evaluated
            asset_id: The asset they want to invest in
            decision: {
                "approved": bool,
                "classification": str,
                "restrictions": list,
                "reasoning": str,
                "confidence": float
            }
        """
        payload = {
            "investor_id": investor_id,
            "asset_id": asset_id,
            "decision": decision,
            "decided_at": datetime.utcnow().isoformat(),
            "decided_by": "ai-compliance-engine"
        }
        response = await self._request("POST", "/compliance/decisions", json=payload)
        return response

    async def update_whitelist_status(
        self,
        investor_id: str,
        asset_id: str,
        whitelisted: bool,
        restrictions: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Update investor whitelist status on-chain.

        This triggers the backend to call the smart contract's
        addToWhitelist() or removeFromWhitelist() function.
        """
        payload = {
            "investor_id": investor_id,
            "asset_id": asset_id,
            "whitelisted": whitelisted,
            "restrictions": restrictions or {},
            "updated_by": "ai-compliance-engine"
        }
        response = await self._request("POST", "/compliance/whitelist", json=payload)
        return response

    async def get_asset_compliance_rules(self, asset_id: str) -> Dict[str, Any]:
        """Fetch compliance rules configured for a specific asset."""
        response = await self._request("GET", f"/assets/{asset_id}/compliance-rules")
        return response

    async def _request(
        self,
        method: str,
        path: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make HTTP request with retry logic."""
        last_exception = None

        for attempt in range(self.config.max_retries):
            try:
                response = await self.client.request(method, path, **kwargs)
                response.raise_for_status()
                return response.json()

            except httpx.HTTPStatusError as e:
                logger.error(f"HTTP error {e.response.status_code}: {e.response.text}")
                if e.response.status_code < 500:
                    raise  # Don't retry client errors
                last_exception = e

            except httpx.RequestError as e:
                logger.error(f"Request error: {e}")
                last_exception = e

            # Exponential backoff
            await asyncio.sleep(2 ** attempt)

        raise last_exception

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()


# Webhook handler for async compliance results
class ComplianceWebhookHandler:
    """
    Receives webhooks from main API when investor data changes.

    Triggers re-evaluation of compliance status when:
    - New documents uploaded
    - Investor data updated
    - Regulatory rules change
    """

    def __init__(self, api_connector: APIConnector):
        self.api = api_connector

    async def handle_investor_updated(self, payload: Dict[str, Any]):
        """Handle investor data update webhook."""
        investor_id = payload["investor_id"]
        logger.info(f"Investor updated: {investor_id}, triggering re-evaluation")

        # Fetch updated data and re-run compliance
        # This would call your AI models
        pass

    async def handle_document_uploaded(self, payload: Dict[str, Any]):
        """Handle new document upload webhook."""
        investor_id = payload["investor_id"]
        document_id = payload["document_id"]
        logger.info(f"New document {document_id} for investor {investor_id}")

        # Process document through jurisdiction classifier
        pass

    async def handle_rules_updated(self, payload: Dict[str, Any]):
        """Handle compliance rules update webhook."""
        asset_id = payload["asset_id"]
        logger.info(f"Rules updated for asset {asset_id}, re-evaluating all investors")

        # Batch re-evaluation of all investors for this asset
        pass
