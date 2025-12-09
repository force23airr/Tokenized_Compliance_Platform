#!/usr/bin/env python3
"""
MAS (Monetary Authority of Singapore) Scraper

Monitors MAS for regulatory updates related to:
- Securities and Futures Act amendments
- Accredited investor definitions
- Capital Markets Services regulations
- Digital payment token regulations
"""

import os
import json
import logging
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict

import httpx
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# MAS website URLs
MAS_URLS = {
    "news": "https://www.mas.gov.sg/news",
    "regulations": "https://www.mas.gov.sg/regulation",
    "circulars": "https://www.mas.gov.sg/regulation/circulars",
}

# Keywords that indicate relevant regulatory changes
RELEVANT_KEYWORDS = [
    "securities and futures act",
    "sfa",
    "accredited investor",
    "capital markets",
    "cms license",
    "digital payment token",
    "dpt",
    "collective investment scheme",
    "exempt fund manager",
    "private placement",
    "section 275",
    "section 4a",
]

# Breaking change keywords
BREAKING_CHANGE_KEYWORDS = [
    "amendment",
    "new regulation",
    "effective",
    "revised",
    "updated threshold",
    "consultation paper",
    "final regulation",
]

PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "jurisdictions"
UPDATES_DIR = PROJECT_ROOT / "data" / "regulatory_updates"


@dataclass
class MASUpdate:
    """Represents a regulatory update from MAS."""
    id: str
    title: str
    summary: str
    url: str
    published_date: datetime
    category: str
    keywords_matched: List[str]
    is_breaking_change: bool
    document_type: Optional[str] = None

    def to_dict(self) -> Dict:
        d = asdict(self)
        d['published_date'] = self.published_date.isoformat()
        return d


class MASScraper:
    """Scraper for MAS regulatory updates."""

    def __init__(self):
        self.client = httpx.Client(
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; RWA-Platform-Compliance-Monitor/1.0)",
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=30.0,
            follow_redirects=True,
        )
        self.updates_dir = UPDATES_DIR / "mas"
        self.updates_dir.mkdir(parents=True, exist_ok=True)

    def fetch_page(self, url: str) -> Optional[str]:
        """Fetch webpage content."""
        try:
            response = self.client.get(url)
            response.raise_for_status()
            return response.text
        except Exception as e:
            logger.error(f"Failed to fetch {url}: {e}")
            return None

    def parse_news_page(self, content: str) -> List[Dict]:
        """Parse MAS news page for regulatory updates."""
        entries = []
        try:
            soup = BeautifulSoup(content, 'html.parser')

            # Find news items (adjust selectors based on actual MAS website structure)
            news_items = soup.find_all('div', class_='news-item') or \
                         soup.find_all('article') or \
                         soup.find_all('li', class_='item')

            for item in news_items[:20]:  # Limit to 20 items
                title_elem = item.find(['h2', 'h3', 'a', 'span'], class_=['title', 'heading'])
                summary_elem = item.find(['p', 'div'], class_=['summary', 'description', 'excerpt'])
                link_elem = item.find('a', href=True)
                date_elem = item.find(['time', 'span', 'div'], class_=['date', 'datetime', 'published'])

                title = title_elem.get_text(strip=True) if title_elem else ''
                summary = summary_elem.get_text(strip=True) if summary_elem else ''
                url = link_elem['href'] if link_elem else ''
                date_str = date_elem.get_text(strip=True) if date_elem else ''

                if title:
                    entries.append({
                        'title': title,
                        'summary': summary,
                        'url': url if url.startswith('http') else f"https://www.mas.gov.sg{url}",
                        'date': date_str,
                    })
        except Exception as e:
            logger.error(f"Failed to parse news page: {e}")

        return entries

    def is_relevant(self, title: str, summary: str) -> tuple[bool, List[str]]:
        """Check if update is relevant to our compliance needs."""
        text = f"{title} {summary}".lower()
        matched = [kw for kw in RELEVANT_KEYWORDS if kw in text]
        return len(matched) > 0, matched

    def is_breaking_change(self, title: str, summary: str) -> bool:
        """Check if update represents a breaking change."""
        text = f"{title} {summary}".lower()
        return any(kw in text for kw in BREAKING_CHANGE_KEYWORDS)

    def parse_date(self, date_str: str) -> datetime:
        """Parse date string to datetime."""
        formats = [
            "%d %b %Y",
            "%d %B %Y",
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%B %d, %Y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue
        return datetime.now()

    def check_for_updates(self) -> List[MASUpdate]:
        """Check MAS website for relevant updates."""
        updates = []

        for category, url in MAS_URLS.items():
            logger.info(f"Checking MAS {category}...")
            content = self.fetch_page(url)

            if not content:
                continue

            entries = self.parse_news_page(content)

            for entry in entries:
                is_rel, keywords = self.is_relevant(
                    entry.get('title', ''),
                    entry.get('summary', '')
                )

                if is_rel:
                    update = MASUpdate(
                        id=hashlib.md5(entry.get('url', '').encode()).hexdigest()[:12],
                        title=entry.get('title', ''),
                        summary=entry.get('summary', ''),
                        url=entry.get('url', ''),
                        published_date=self.parse_date(entry.get('date', '')),
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

    def get_new_updates(self, since_hours: int = 24) -> List[MASUpdate]:
        """Get updates from the last N hours."""
        all_updates = self.check_for_updates()
        cutoff = datetime.now() - timedelta(hours=since_hours)

        return [u for u in all_updates if u.published_date > cutoff]

    def save_updates(self, updates: List[MASUpdate]) -> None:
        """Save updates to JSON file."""
        if not updates:
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = self.updates_dir / f"mas_updates_{timestamp}.json"

        data = {
            "fetched_at": datetime.now().isoformat(),
            "count": len(updates),
            "updates": [u.to_dict() for u in updates],
        }

        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)

        logger.info(f"Saved {len(updates)} updates to {filename}")

    def update_jurisdiction_rules(self, updates: List[MASUpdate]) -> bool:
        """Update SG jurisdiction rules based on regulatory changes."""
        if not updates:
            return False

        breaking_updates = [u for u in updates if u.is_breaking_change]

        if not breaking_updates:
            logger.info("No breaking changes detected")
            return False

        # Load current SG rules
        rules_file = DATA_DIR / "sg_mas_guidelines.json"
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
        current_rules["changelog"] = changelog[-10:]

        # Save updated rules
        with open(rules_file, 'w') as f:
            json.dump(current_rules, f, indent=2)

        logger.info(f"Updated SG rules from {old_version} to {new_version}")
        return True

    def close(self):
        """Close HTTP client."""
        self.client.close()


def run_mas_scraper() -> Dict[str, Any]:
    """Run the MAS scraper and return results."""
    scraper = MASScraper()
    try:
        # For MAS, check last 48 hours since updates may be less frequent
        updates = scraper.get_new_updates(since_hours=48)
        scraper.save_updates(updates)

        rules_updated = scraper.update_jurisdiction_rules(updates)

        return {
            "source": "MAS Singapore",
            "timestamp": datetime.now().isoformat(),
            "updates_found": len(updates),
            "breaking_changes": sum(1 for u in updates if u.is_breaking_change),
            "rules_updated": rules_updated,
            "updates": [u.to_dict() for u in updates],
        }
    finally:
        scraper.close()


if __name__ == "__main__":
    result = run_mas_scraper()
    print(json.dumps(result, indent=2))
