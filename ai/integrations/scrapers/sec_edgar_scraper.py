#!/usr/bin/env python3
"""
SEC EDGAR Scraper

Monitors SEC EDGAR for regulatory updates related to:
- Regulation D amendments
- Accredited investor definition changes
- No-action letters affecting token offerings
- Rule 144 modifications
"""

import os
import json
import logging
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict
import xml.etree.ElementTree as ET

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# SEC EDGAR RSS feeds
SEC_RSS_FEEDS = {
    "rules": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=RULE&owner=include&count=40&output=atom",
    "no_action": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=NO-ACT&owner=include&count=40&output=atom",
    "releases": "https://www.sec.gov/news/pressreleases.rss",
}

# Keywords that indicate relevant regulatory changes
RELEVANT_KEYWORDS = [
    "regulation d",
    "reg d",
    "accredited investor",
    "qualified purchaser",
    "private placement",
    "rule 506",
    "rule 144",
    "holding period",
    "securities offering",
    "digital asset",
    "tokenized",
    "blockchain",
    "exempt offering",
]

# Breaking change keywords that should trigger retraining
BREAKING_CHANGE_KEYWORDS = [
    "amendment",
    "repeal",
    "new rule",
    "effective immediately",
    "threshold change",
    "definition change",
    "final rule",
    "supersedes",
]

PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "jurisdictions"
UPDATES_DIR = PROJECT_ROOT / "data" / "regulatory_updates"


@dataclass
class RegulatoryUpdate:
    """Represents a regulatory update from SEC."""
    id: str
    title: str
    summary: str
    url: str
    published_date: datetime
    category: str
    keywords_matched: List[str]
    is_breaking_change: bool
    raw_content: Optional[str] = None

    def to_dict(self) -> Dict:
        d = asdict(self)
        d['published_date'] = self.published_date.isoformat()
        return d


class SECEdgarScraper:
    """Scraper for SEC EDGAR regulatory updates."""

    def __init__(self):
        self.client = httpx.Client(
            headers={
                "User-Agent": "RWA-Platform-Compliance-Monitor support@rwa-platform.com",
                "Accept": "application/atom+xml, application/xml, text/xml",
            },
            timeout=30.0,
        )
        self.updates_dir = UPDATES_DIR / "sec"
        self.updates_dir.mkdir(parents=True, exist_ok=True)

    def fetch_feed(self, feed_url: str) -> Optional[str]:
        """Fetch RSS/Atom feed content."""
        try:
            response = self.client.get(feed_url)
            response.raise_for_status()
            return response.text
        except Exception as e:
            logger.error(f"Failed to fetch feed {feed_url}: {e}")
            return None

    def parse_atom_feed(self, content: str) -> List[Dict]:
        """Parse Atom feed and extract entries."""
        entries = []
        try:
            # Handle namespace
            namespaces = {
                'atom': 'http://www.w3.org/2005/Atom',
            }

            root = ET.fromstring(content)

            for entry in root.findall('.//atom:entry', namespaces):
                title_elem = entry.find('atom:title', namespaces)
                summary_elem = entry.find('atom:summary', namespaces)
                link_elem = entry.find('atom:link', namespaces)
                updated_elem = entry.find('atom:updated', namespaces)
                id_elem = entry.find('atom:id', namespaces)

                entries.append({
                    'id': id_elem.text if id_elem is not None else '',
                    'title': title_elem.text if title_elem is not None else '',
                    'summary': summary_elem.text if summary_elem is not None else '',
                    'url': link_elem.get('href', '') if link_elem is not None else '',
                    'updated': updated_elem.text if updated_elem is not None else '',
                })
        except ET.ParseError as e:
            logger.error(f"Failed to parse Atom feed: {e}")

        return entries

    def is_relevant(self, title: str, summary: str) -> tuple[bool, List[str]]:
        """Check if update is relevant to our compliance needs."""
        text = f"{title} {summary}".lower()
        matched = [kw for kw in RELEVANT_KEYWORDS if kw in text]
        return len(matched) > 0, matched

    def is_breaking_change(self, title: str, summary: str) -> bool:
        """Check if update represents a breaking change requiring retraining."""
        text = f"{title} {summary}".lower()
        return any(kw in text for kw in BREAKING_CHANGE_KEYWORDS)

    def check_for_updates(self) -> List[RegulatoryUpdate]:
        """Check all SEC feeds for relevant updates."""
        updates = []

        for category, feed_url in SEC_RSS_FEEDS.items():
            logger.info(f"Checking SEC {category} feed...")
            content = self.fetch_feed(feed_url)

            if not content:
                continue

            entries = self.parse_atom_feed(content)

            for entry in entries:
                is_rel, keywords = self.is_relevant(
                    entry.get('title', ''),
                    entry.get('summary', '')
                )

                if is_rel:
                    # Parse date
                    updated_str = entry.get('updated', '')
                    try:
                        pub_date = datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
                    except (ValueError, TypeError):
                        pub_date = datetime.now()

                    update = RegulatoryUpdate(
                        id=hashlib.md5(entry.get('id', '').encode()).hexdigest()[:12],
                        title=entry.get('title', ''),
                        summary=entry.get('summary', ''),
                        url=entry.get('url', ''),
                        published_date=pub_date,
                        category=category,
                        keywords_matched=keywords,
                        is_breaking_change=self.is_breaking_change(
                            entry.get('title', ''),
                            entry.get('summary', '')
                        ),
                    )
                    updates.append(update)
                    logger.info(f"Found relevant update: {update.title}")

        return updates

    def get_new_updates(self, since_hours: int = 24) -> List[RegulatoryUpdate]:
        """Get updates from the last N hours."""
        all_updates = self.check_for_updates()
        cutoff = datetime.now() - timedelta(hours=since_hours)

        # Make cutoff timezone-aware if updates have timezone info
        new_updates = []
        for u in all_updates:
            # Compare dates, handling timezone
            if u.published_date.replace(tzinfo=None) > cutoff.replace(tzinfo=None):
                new_updates.append(u)

        return new_updates

    def save_updates(self, updates: List[RegulatoryUpdate]) -> None:
        """Save updates to JSON file for audit trail."""
        if not updates:
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = self.updates_dir / f"sec_updates_{timestamp}.json"

        data = {
            "fetched_at": datetime.now().isoformat(),
            "count": len(updates),
            "updates": [u.to_dict() for u in updates],
        }

        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)

        logger.info(f"Saved {len(updates)} updates to {filename}")

    def update_jurisdiction_rules(self, updates: List[RegulatoryUpdate]) -> bool:
        """Update jurisdiction rules based on regulatory changes."""
        if not updates:
            return False

        breaking_updates = [u for u in updates if u.is_breaking_change]

        if not breaking_updates:
            logger.info("No breaking changes detected")
            return False

        # Load current US rules
        rules_file = DATA_DIR / "us_sec_rules.json"
        if rules_file.exists():
            with open(rules_file, 'r') as f:
                current_rules = json.load(f)
        else:
            current_rules = {}

        # Update version and changelog
        old_version = current_rules.get("version", "2024.01.01.001")
        new_version = f"{datetime.now().strftime('%Y.%m.%d')}.001"

        changelog = current_rules.get("changelog", [])
        for update in breaking_updates:
            changelog.append({
                "date": datetime.now().isoformat(),
                "update_id": update.id,
                "title": update.title,
                "url": update.url,
            })

        current_rules["version"] = new_version
        current_rules["updated_at"] = datetime.now().isoformat()
        current_rules["changelog"] = changelog[-10:]  # Keep last 10

        # Save updated rules
        with open(rules_file, 'w') as f:
            json.dump(current_rules, f, indent=2)

        logger.info(f"Updated US rules from {old_version} to {new_version}")
        return True

    def close(self):
        """Close HTTP client."""
        self.client.close()


def run_sec_scraper() -> Dict[str, Any]:
    """Run the SEC scraper and return results."""
    scraper = SECEdgarScraper()
    try:
        updates = scraper.get_new_updates(since_hours=24)
        scraper.save_updates(updates)

        rules_updated = scraper.update_jurisdiction_rules(updates)

        return {
            "source": "SEC EDGAR",
            "timestamp": datetime.now().isoformat(),
            "updates_found": len(updates),
            "breaking_changes": sum(1 for u in updates if u.is_breaking_change),
            "rules_updated": rules_updated,
            "updates": [u.to_dict() for u in updates],
        }
    finally:
        scraper.close()


if __name__ == "__main__":
    result = run_sec_scraper()
    print(json.dumps(result, indent=2))
