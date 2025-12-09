"""
Regulatory Feed - Live updates from regulatory sources.

Monitors and ingests:
- SEC EDGAR filings and rule changes
- FCA regulatory updates
- MAS circulars and guidelines
- FATF high-risk jurisdiction updates
- Sanctions list changes (OFAC, UN, EU)
"""

import asyncio
import httpx
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from pathlib import Path
import json
import logging

logger = logging.getLogger(__name__)


@dataclass
class RegulatorySource:
    """Configuration for a regulatory data source."""
    name: str
    jurisdiction: str
    base_url: str
    feed_type: str  # rss, api, scrape
    update_frequency_hours: int
    enabled: bool = True


# Default regulatory sources
REGULATORY_SOURCES = [
    RegulatorySource(
        name="SEC EDGAR",
        jurisdiction="US",
        base_url="https://www.sec.gov/cgi-bin/browse-edgar",
        feed_type="api",
        update_frequency_hours=24
    ),
    RegulatorySource(
        name="SEC Rules",
        jurisdiction="US",
        base_url="https://www.sec.gov/rules",
        feed_type="rss",
        update_frequency_hours=24
    ),
    RegulatorySource(
        name="FCA Handbook",
        jurisdiction="UK",
        base_url="https://www.handbook.fca.org.uk",
        feed_type="scrape",
        update_frequency_hours=168  # Weekly
    ),
    RegulatorySource(
        name="ESMA Updates",
        jurisdiction="EU",
        base_url="https://www.esma.europa.eu/press-news/esma-news",
        feed_type="rss",
        update_frequency_hours=24
    ),
    RegulatorySource(
        name="MAS Regulations",
        jurisdiction="SG",
        base_url="https://www.mas.gov.sg/regulation",
        feed_type="scrape",
        update_frequency_hours=168
    ),
    RegulatorySource(
        name="FATF",
        jurisdiction="GLOBAL",
        base_url="https://www.fatf-gafi.org",
        feed_type="scrape",
        update_frequency_hours=168
    ),
    RegulatorySource(
        name="OFAC SDN",
        jurisdiction="US",
        base_url="https://sanctionslistservice.ofac.treas.gov/api",
        feed_type="api",
        update_frequency_hours=24
    )
]


class RegulatoryFeed:
    """
    Monitors regulatory sources for updates relevant to RWA compliance.

    Updates are:
    1. Fetched from official sources
    2. Parsed and classified by relevance
    3. Stored in the jurisdiction data files
    4. Trigger model retraining if significant
    """

    def __init__(
        self,
        data_dir: Path = Path(__file__).parent.parent / "data" / "jurisdictions",
        sources: Optional[List[RegulatorySource]] = None
    ):
        self.data_dir = data_dir
        self.sources = sources or REGULATORY_SOURCES
        self.client = httpx.AsyncClient(timeout=60)
        self.last_check: Dict[str, datetime] = {}

    async def check_all_sources(self) -> List[Dict[str, Any]]:
        """Check all regulatory sources for updates."""
        updates = []

        for source in self.sources:
            if not source.enabled:
                continue

            # Check if enough time has passed since last check
            last = self.last_check.get(source.name, datetime.min)
            if datetime.utcnow() - last < timedelta(hours=source.update_frequency_hours):
                continue

            try:
                source_updates = await self._check_source(source)
                updates.extend(source_updates)
                self.last_check[source.name] = datetime.utcnow()

            except Exception as e:
                logger.error(f"Error checking {source.name}: {e}")

        return updates

    async def _check_source(self, source: RegulatorySource) -> List[Dict[str, Any]]:
        """Check a single regulatory source for updates."""
        logger.info(f"Checking {source.name} for updates...")

        if source.feed_type == "api":
            return await self._check_api_source(source)
        elif source.feed_type == "rss":
            return await self._check_rss_source(source)
        else:
            return await self._check_scrape_source(source)

    async def _check_api_source(self, source: RegulatorySource) -> List[Dict[str, Any]]:
        """Check API-based regulatory source."""
        # Example: OFAC SDN List
        if source.name == "OFAC SDN":
            response = await self.client.get(
                f"{source.base_url}/SdnList",
                headers={"Accept": "application/json"}
            )
            if response.status_code == 200:
                return self._parse_ofac_update(response.json())

        return []

    async def _check_rss_source(self, source: RegulatorySource) -> List[Dict[str, Any]]:
        """Check RSS feed for regulatory updates."""
        # Would use feedparser or similar
        return []

    async def _check_scrape_source(self, source: RegulatorySource) -> List[Dict[str, Any]]:
        """Scrape regulatory website for updates."""
        # Would use beautifulsoup or similar
        return []

    def _parse_ofac_update(self, data: Dict) -> List[Dict[str, Any]]:
        """Parse OFAC SDN list update."""
        updates = []
        # Parse and return relevant updates
        return updates

    async def update_jurisdiction_data(
        self,
        jurisdiction: str,
        updates: List[Dict[str, Any]]
    ):
        """Apply updates to jurisdiction data file."""
        file_path = self.data_dir / f"{jurisdiction.lower()}_rules.json"

        if file_path.exists():
            with open(file_path, 'r') as f:
                current_data = json.load(f)
        else:
            current_data = {"jurisdiction": jurisdiction, "rules": []}

        # Apply updates
        current_data["last_updated"] = datetime.utcnow().isoformat()
        current_data["updates"] = current_data.get("updates", []) + updates

        with open(file_path, 'w') as f:
            json.dump(current_data, f, indent=2)

        logger.info(f"Updated {jurisdiction} with {len(updates)} changes")

    async def start_monitoring(self, check_interval_hours: int = 6):
        """Start continuous monitoring of regulatory sources."""
        logger.info("Starting regulatory feed monitoring...")

        while True:
            try:
                updates = await self.check_all_sources()

                if updates:
                    logger.info(f"Found {len(updates)} regulatory updates")

                    # Group by jurisdiction
                    by_jurisdiction = {}
                    for update in updates:
                        jur = update.get("jurisdiction", "UNKNOWN")
                        by_jurisdiction.setdefault(jur, []).append(update)

                    # Apply updates
                    for jur, jur_updates in by_jurisdiction.items():
                        await self.update_jurisdiction_data(jur, jur_updates)

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")

            await asyncio.sleep(check_interval_hours * 3600)

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


# High-risk jurisdiction tracker
class FATFJurisdictionTracker:
    """
    Tracks FATF high-risk and increased monitoring jurisdictions.

    Categories:
    - Black list: High-risk, call to action
    - Grey list: Increased monitoring
    """

    FATF_HIGH_RISK_URL = "https://www.fatf-gafi.org/en/publications/high-risk-and-other-monitored-jurisdictions.html"

    def __init__(self):
        self.high_risk: List[str] = []
        self.increased_monitoring: List[str] = []
        self.last_updated: Optional[datetime] = None

    async def update_lists(self):
        """Fetch current FATF jurisdiction lists."""
        # In production, would scrape or use official API
        # For now, hardcoded as of early 2025
        self.high_risk = ["DPRK", "IR", "MM"]  # North Korea, Iran, Myanmar
        self.increased_monitoring = [
            "BF", "CM", "CD", "HT", "KE", "ML", "MZ", "NG",
            "PH", "SN", "ZA", "SS", "SY", "TZ", "VN", "YE"
        ]
        self.last_updated = datetime.utcnow()

    def get_risk_level(self, country_code: str) -> str:
        """Get FATF risk level for a country."""
        if country_code.upper() in self.high_risk:
            return "HIGH_RISK"
        elif country_code.upper() in self.increased_monitoring:
            return "INCREASED_MONITORING"
        else:
            return "STANDARD"

    def is_blocked(self, country_code: str) -> bool:
        """Check if country is blocked for RWA transactions."""
        return country_code.upper() in self.high_risk
