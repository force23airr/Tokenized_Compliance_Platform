#!/usr/bin/env python3
"""
Daily Regulatory Update Scheduler

Orchestrates daily checks of regulatory feeds and triggers appropriate actions:
1. Fetch updates from SEC and MAS
2. **NEW: Analyze updates with Regulatory Oracle for granular rule changes**
3. Update jurisdiction rules if needed
4. Invalidate Redis cache for affected jurisdictions
5. Trigger retrain if breaking changes detected

The Oracle Integration:
- Breaking changes are analyzed by AI for specific rule modifications
- Proposals are queued for human review before applying
- This enables real-time, granular rule updates vs. manual changelog bumps
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

import httpx

# Import our scrapers and trigger
from ..scrapers.sec_edgar_scraper import run_sec_scraper
from ..scrapers.mas_scraper import run_mas_scraper
from .retrain_trigger import check_and_trigger, RetrainTrigger

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import the Regulatory Oracle
# Use sys.path manipulation for robust imports across different execution contexts
import sys
_ai_dir = Path(__file__).parent.parent.parent
if str(_ai_dir) not in sys.path:
    sys.path.insert(0, str(_ai_dir))

try:
    from services.regulatory_oracle import get_oracle, RegulatoryOracle
    ORACLE_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Regulatory Oracle not available: {e}")
    ORACLE_AVAILABLE = False

PROJECT_ROOT = Path(__file__).parent.parent.parent
RESULTS_DIR = PROJECT_ROOT / "data" / "regulatory_updates" / "daily_runs"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# API endpoint for cache invalidation
AI_API_URL = os.environ.get("AI_COMPLIANCE_API_URL", "http://localhost:8000")


class DailyUpdateScheduler:
    """Orchestrates daily regulatory updates."""

    def __init__(self):
        self.results: Dict[str, Any] = {
            "run_id": f"daily_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "started_at": datetime.now().isoformat(),
            "completed_at": None,
            "sources": {},
            "total_updates": 0,
            "breaking_changes": 0,
            "retrain_triggered": False,
            "cache_invalidated": [],
            "errors": [],
            # NEW: Oracle tracking
            "oracle_proposals": [],
            "oracle_enabled": ORACLE_AVAILABLE,
        }
        # Initialize Oracle if available
        self.oracle = get_oracle() if ORACLE_AVAILABLE else None

    def run_sec_updates(self) -> Dict[str, Any]:
        """Run SEC EDGAR scraper."""
        logger.info("Running SEC EDGAR scraper...")
        try:
            result = run_sec_scraper()
            self.results["sources"]["sec"] = result
            self.results["total_updates"] += result.get("updates_found", 0)
            self.results["breaking_changes"] += result.get("breaking_changes", 0)
            return result
        except Exception as e:
            logger.error(f"SEC scraper failed: {e}")
            self.results["errors"].append(f"SEC: {str(e)}")
            return {"error": str(e)}

    def run_mas_updates(self) -> Dict[str, Any]:
        """Run MAS scraper."""
        logger.info("Running MAS scraper...")
        try:
            result = run_mas_scraper()
            self.results["sources"]["mas"] = result
            self.results["total_updates"] += result.get("updates_found", 0)
            self.results["breaking_changes"] += result.get("breaking_changes", 0)
            return result
        except Exception as e:
            logger.error(f"MAS scraper failed: {e}")
            self.results["errors"].append(f"MAS: {str(e)}")
            return {"error": str(e)}

    def check_retrain_triggers(self) -> Optional[Dict]:
        """Check if any updates require model retraining."""
        all_updates = []

        # Collect all updates
        for source, result in self.results["sources"].items():
            if "updates" in result:
                for update in result["updates"]:
                    update["source"] = source.upper()
                    all_updates.append(update)

        if not all_updates:
            logger.info("No updates to check for retraining")
            return None

        # Check for breaking changes
        breaking = [u for u in all_updates if u.get("is_breaking_change", False)]

        if breaking:
            logger.warning(f"Found {len(breaking)} breaking changes")
            event = check_and_trigger(
                updates=all_updates,
                source="Daily Regulatory Feed",
            )
            if event:
                self.results["retrain_triggered"] = True
                return event.to_dict()

        return None

    async def process_with_oracle(self) -> List[Dict[str, Any]]:
        """
        Process breaking changes through the Regulatory Oracle.

        This is the NEW granular update system:
        1. Collects breaking changes from scrapers
        2. Sends each to the Oracle for AI analysis
        3. Creates pending change proposals for human review

        Returns:
            List of Oracle proposals created
        """
        if not self.oracle:
            logger.info("Oracle not available, skipping granular analysis")
            return []

        proposals = []

        # Process SEC updates
        sec_result = self.results["sources"].get("sec", {})
        if sec_result.get("updates"):
            sec_breaking = [
                u for u in sec_result["updates"]
                if u.get("is_breaking_change", False)
            ]
            logger.info(f"Processing {len(sec_breaking)} SEC breaking changes through Oracle...")

            for update in sec_breaking:
                try:
                    # Prepare update text for Oracle
                    update_text = f"""
SEC Regulatory Update: {update.get('title', 'Unknown')}

Summary: {update.get('summary', '')}

Category: {update.get('category', 'rules')}
Published: {update.get('published_date', 'Unknown')}
URL: {update.get('url', '')}

Keywords Matched: {', '.join(update.get('keywords_matched', []))}
"""
                    result = await self.oracle.process_update(
                        update_text=update_text,
                        jurisdiction="US",
                        source_update=update
                    )

                    if result.get("status") == "proposal_created":
                        proposals.append(result)
                        logger.info(f"Oracle created proposal: {result.get('summary')}")

                except Exception as e:
                    logger.error(f"Oracle failed to process update: {e}")
                    self.results["errors"].append(f"Oracle SEC: {str(e)}")

        # Process MAS updates
        mas_result = self.results["sources"].get("mas", {})
        if mas_result.get("updates"):
            mas_breaking = [
                u for u in mas_result["updates"]
                if u.get("is_breaking_change", False)
            ]
            logger.info(f"Processing {len(mas_breaking)} MAS breaking changes through Oracle...")

            for update in mas_breaking:
                try:
                    update_text = f"""
MAS Regulatory Update: {update.get('title', 'Unknown')}

Summary: {update.get('summary', '')}

Category: {update.get('category', 'circular')}
Published: {update.get('published_date', 'Unknown')}
URL: {update.get('url', '')}
"""
                    result = await self.oracle.process_update(
                        update_text=update_text,
                        jurisdiction="SG",
                        source_update=update
                    )

                    if result.get("status") == "proposal_created":
                        proposals.append(result)
                        logger.info(f"Oracle created proposal: {result.get('summary')}")

                except Exception as e:
                    logger.error(f"Oracle failed to process update: {e}")
                    self.results["errors"].append(f"Oracle MAS: {str(e)}")

        return proposals

    async def invalidate_cache(self, jurisdictions: List[str]) -> None:
        """Invalidate Redis cache for affected jurisdictions."""
        async with httpx.AsyncClient() as client:
            for jur in jurisdictions:
                try:
                    # Call AI API to invalidate cache
                    response = await client.post(
                        f"{AI_API_URL}/admin/invalidate-cache",
                        json={"jurisdiction": jur},
                        timeout=10.0,
                    )
                    if response.status_code == 200:
                        self.results["cache_invalidated"].append(jur)
                        logger.info(f"Cache invalidated for {jur}")
                    else:
                        logger.warning(f"Cache invalidation failed for {jur}: {response.status_code}")
                except Exception as e:
                    logger.error(f"Cache invalidation error for {jur}: {e}")

    def determine_affected_jurisdictions(self) -> List[str]:
        """Determine which jurisdictions were affected by updates."""
        affected = set()

        sec_result = self.results["sources"].get("sec", {})
        if sec_result.get("updates_found", 0) > 0 or sec_result.get("rules_updated"):
            affected.add("US")

        mas_result = self.results["sources"].get("mas", {})
        if mas_result.get("updates_found", 0) > 0 or mas_result.get("rules_updated"):
            affected.add("SG")

        return list(affected)

    def save_results(self) -> str:
        """Save run results to file."""
        self.results["completed_at"] = datetime.now().isoformat()

        filename = RESULTS_DIR / f"{self.results['run_id']}.json"
        with open(filename, 'w') as f:
            json.dump(self.results, f, indent=2)

        logger.info(f"Results saved to {filename}")
        return str(filename)

    async def run(self) -> Dict[str, Any]:
        """Execute the full daily update process."""
        logger.info("=" * 60)
        logger.info("Starting daily regulatory update process")
        logger.info(f"  Oracle enabled: {self.results['oracle_enabled']}")
        logger.info("=" * 60)

        # Run scrapers (sequentially to avoid rate limiting)
        self.run_sec_updates()
        self.run_mas_updates()

        # Check for retrain triggers
        retrain_event = self.check_retrain_triggers()
        if retrain_event:
            self.results["retrain_event"] = retrain_event

        # NEW: Process breaking changes through Oracle for granular updates
        if self.results["breaking_changes"] > 0 and self.oracle:
            logger.info("Processing breaking changes through Regulatory Oracle...")
            try:
                proposals = await self.process_with_oracle()
                self.results["oracle_proposals"] = proposals
                logger.info(f"Oracle created {len(proposals)} change proposals")
            except Exception as e:
                logger.error(f"Oracle processing failed: {e}")
                self.results["errors"].append(f"Oracle: {str(e)}")

        # Invalidate cache for affected jurisdictions
        affected = self.determine_affected_jurisdictions()
        if affected:
            await self.invalidate_cache(affected)

        # Save results
        results_file = self.save_results()

        # Summary
        logger.info("=" * 60)
        logger.info("Daily update complete")
        logger.info(f"  Total updates: {self.results['total_updates']}")
        logger.info(f"  Breaking changes: {self.results['breaking_changes']}")
        logger.info(f"  Oracle proposals: {len(self.results.get('oracle_proposals', []))}")
        logger.info(f"  Retrain triggered: {self.results['retrain_triggered']}")
        logger.info(f"  Cache invalidated: {self.results['cache_invalidated']}")
        logger.info(f"  Errors: {len(self.results['errors'])}")
        logger.info("=" * 60)

        return self.results


def run_daily_update() -> Dict[str, Any]:
    """Synchronous wrapper for daily update."""
    scheduler = DailyUpdateScheduler()
    return asyncio.run(scheduler.run())


# For cron job or scheduled task
if __name__ == "__main__":
    results = run_daily_update()
    print(json.dumps(results, indent=2))
