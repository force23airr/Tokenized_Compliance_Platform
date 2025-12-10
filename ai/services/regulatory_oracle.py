#!/usr/bin/env python3
"""
Regulatory Oracle Service

The "Mechanic" that connects regulatory scrapers to jurisdiction rule files.
Uses AI to analyze regulatory updates and propose specific JSON modifications.

Architecture:
    Scraper → Oracle → Pending Changes → Human Review → Apply

The Oracle:
1. Receives regulatory update text from scrapers
2. Calls TogetherClient.analyze_regulatory_impact() for AI analysis
3. Creates structured change proposals with exact JSON paths
4. Saves proposals to pending files for human review
5. Provides approval/rejection workflow
"""

import json
import logging
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime
from dataclasses import dataclass, asdict
from enum import Enum

import sys
from pathlib import Path

# Add parent directory to path for imports
_parent_dir = Path(__file__).parent.parent
if str(_parent_dir) not in sys.path:
    sys.path.insert(0, str(_parent_dir))

from inference.providers.together_client import (
    get_client,
    RegulatoryChangeProposal
)

# Import Impact Simulator (lazy to avoid circular imports)
_simulator = None

def _get_simulator():
    """Lazy-load the impact simulator."""
    global _simulator
    if _simulator is None:
        from .impact_simulator import get_simulator
        _simulator = get_simulator()
    return _simulator

logger = logging.getLogger(__name__)


class ChangeStatus(str, Enum):
    """Status of a proposed change"""
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED = "applied"
    EXPIRED = "expired"


@dataclass
class PendingChange:
    """A pending regulatory change awaiting human review"""
    id: str
    created_at: str
    jurisdiction: str
    status: ChangeStatus
    proposal: Dict[str, Any]  # Serialized RegulatoryChangeProposal
    source_update: Dict[str, Any]  # Original update from scraper
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_notes: Optional[str] = None
    applied_at: Optional[str] = None
    # God Mode: Impact Simulation Results
    impact_simulation: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict:
        d = asdict(self)
        d['status'] = self.status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict) -> 'PendingChange':
        data['status'] = ChangeStatus(data['status'])
        return cls(**data)


class RegulatoryOracle:
    """
    The Regulatory Oracle - AI-powered regulatory change detection and proposal.

    This service:
    1. Loads current jurisdiction rules
    2. Analyzes regulatory updates using AI
    3. Proposes specific JSON patches
    4. Manages pending change queue
    5. Applies approved changes

    Usage:
        oracle = RegulatoryOracle()
        result = await oracle.process_update(update_text, "US")
        # Returns: {"status": "proposal_created", "change": {...}}
    """

    # Minimum confidence threshold for creating proposals
    MIN_CONFIDENCE = 0.75

    def __init__(self, rules_dir: Optional[Path] = None, pending_dir: Optional[Path] = None):
        """
        Initialize the Oracle.

        Args:
            rules_dir: Directory containing jurisdiction JSON files
            pending_dir: Directory for pending change files
        """
        base_dir = Path(__file__).parent.parent
        self.rules_dir = rules_dir or base_dir / "data" / "jurisdictions"
        self.pending_dir = pending_dir or base_dir / "data" / "pending_changes"
        self.pending_dir.mkdir(parents=True, exist_ok=True)

        # Client is lazy-loaded to avoid issues if API key not set
        self._client = None

    @property
    def client(self):
        """Lazy-load the Together.ai client"""
        if self._client is None:
            self._client = get_client()
        return self._client

    def _load_rules(self, jurisdiction: str) -> Dict[str, Any]:
        """Load the current ruleset for a jurisdiction."""
        jurisdiction_files = {
            "US": "us_sec_rules.json",
            "SG": "sg_mas_guidelines.json",
            "EU": "eu_mifid_ii.json",
            "GB": "eu_mifid_ii.json",
        }
        filename = jurisdiction_files.get(
            jurisdiction.upper(),
            f"{jurisdiction.lower()}_rules.json"
        )
        path = self.rules_dir / filename

        if not path.exists():
            raise FileNotFoundError(f"Rules file not found: {path}")

        with open(path, 'r') as f:
            return json.load(f)

    def _save_rules(self, jurisdiction: str, rules: Dict[str, Any]) -> None:
        """Save updated ruleset for a jurisdiction."""
        jurisdiction_files = {
            "US": "us_sec_rules.json",
            "SG": "sg_mas_guidelines.json",
            "EU": "eu_mifid_ii.json",
            "GB": "eu_mifid_ii.json",
        }
        filename = jurisdiction_files.get(
            jurisdiction.upper(),
            f"{jurisdiction.lower()}_rules.json"
        )
        path = self.rules_dir / filename

        with open(path, 'w') as f:
            json.dump(rules, f, indent=2)

        logger.info(f"Saved updated rules to {path}")

    def _apply_patch(self, rules: Dict[str, Any], path: str, value: Any) -> Dict[str, Any]:
        """
        Apply a dot-notation path update to a nested dictionary.

        Args:
            rules: The rules dictionary to modify
            path: Dot-notation path (e.g., "exemptions.reg_d_506b.requirements.max_investors")
            value: The new value to set

        Returns:
            Modified rules dictionary
        """
        if not path:
            return rules

        keys = path.split('.')
        ref = rules

        # Navigate to parent of target key
        for key in keys[:-1]:
            if key not in ref:
                ref[key] = {}
            ref = ref[key]

        # Set the value
        ref[keys[-1]] = value
        return rules

    def _get_nested_value(self, rules: Dict[str, Any], path: str) -> Any:
        """Get a value from a nested dictionary using dot notation."""
        if not path:
            return None

        keys = path.split('.')
        ref = rules

        for key in keys:
            if isinstance(ref, dict) and key in ref:
                ref = ref[key]
            else:
                return None

        return ref

    def _generate_change_id(self, proposal: RegulatoryChangeProposal) -> str:
        """Generate a unique ID for a pending change."""
        content = f"{proposal.target_file}:{proposal.field_path}:{proposal.new_value}:{datetime.now().isoformat()}"
        return f"chg_{hashlib.md5(content.encode()).hexdigest()[:12]}"

    async def process_update(
        self,
        update_text: str,
        jurisdiction: str = "US",
        source_update: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Orchestrates the analysis and proposal of a rule change.

        This is the main entry point for the Oracle. It:
        1. Loads current rules for context
        2. Calls AI to analyze the update
        3. Creates a pending change if relevant
        4. Returns the result

        Args:
            update_text: Raw text from regulatory update
            jurisdiction: Target jurisdiction code
            source_update: Optional dict with source metadata (title, url, etc.)

        Returns:
            Dict with status and details
        """
        # 1. Load current rules for context
        try:
            current_rules = self._load_rules(jurisdiction)
        except FileNotFoundError as e:
            logger.error(f"Failed to load rules: {e}")
            return {"status": "error", "reason": str(e)}

        # 2. Consult the Oracle (AI)
        logger.info(f"Oracle analyzing update for {jurisdiction}...")
        proposal = await self.client.analyze_regulatory_impact(
            update_text=update_text,
            current_rules_context=current_rules,
            jurisdiction=jurisdiction
        )

        # 3. Check if actionable
        if not proposal.is_relevant:
            logger.info(f"Update analyzed but not relevant: {proposal.reasoning}")
            return {
                "status": "not_relevant",
                "reason": proposal.reasoning,
                "confidence": proposal.confidence
            }

        if proposal.confidence < self.MIN_CONFIDENCE:
            logger.info(
                f"Update analyzed but confidence too low: {proposal.confidence:.2f} < {self.MIN_CONFIDENCE}"
            )
            return {
                "status": "low_confidence",
                "confidence": proposal.confidence,
                "summary": proposal.summary_of_change,
                "reason": "Confidence below threshold, flagged for manual review"
            }

        # 4. Create pending change
        change_id = self._generate_change_id(proposal)

        # 5. GOD MODE: Run impact simulation BEFORE saving
        impact_simulation = None
        simulation_summary = None
        try:
            simulator = _get_simulator()
            simulation_result = await simulator.simulate_change(proposal, use_mock_data=True)
            impact_simulation = simulation_result.to_dict()
            simulation_summary = {
                "severity": simulation_result.severity.value,
                "impacted_count": simulation_result.impacted_count,
                "impact_percentage": simulation_result.impact_percentage,
                "assets_at_risk_usd": simulation_result.total_assets_at_risk_usd,
                "recommended_strategy": simulation_result.recommended_grandfathering.value,
                "warnings_count": len(simulation_result.warnings)
            }
            logger.info(
                f"Impact simulation complete: {simulation_result.impacted_count} casualties, "
                f"severity={simulation_result.severity.value}"
            )
        except Exception as e:
            logger.warning(f"Impact simulation failed (non-blocking): {e}")
            impact_simulation = {"error": str(e), "status": "failed"}

        pending = PendingChange(
            id=change_id,
            created_at=datetime.now().isoformat(),
            jurisdiction=jurisdiction,
            status=ChangeStatus.PENDING_REVIEW,
            proposal={
                "is_relevant": proposal.is_relevant,
                "confidence": proposal.confidence,
                "summary": proposal.summary_of_change,
                "target_file": proposal.target_file,
                "field_path": proposal.field_path,
                "old_value": proposal.old_value,
                "new_value": proposal.new_value,
                "reasoning": proposal.reasoning,
                "effective_date": proposal.effective_date,
                "requires_immediate_action": proposal.requires_immediate_action,
            },
            source_update=source_update or {
                "text": update_text[:1000],
                "received_at": datetime.now().isoformat()
            },
            impact_simulation=impact_simulation
        )

        # 6. Save pending change
        self._save_pending_change(pending)

        logger.info(
            f"Oracle created proposal: {proposal.summary_of_change} "
            f"(confidence: {proposal.confidence:.2f}, id: {change_id})"
        )

        result = {
            "status": "proposal_created",
            "change_id": change_id,
            "summary": proposal.summary_of_change,
            "field_path": proposal.field_path,
            "old_value": proposal.old_value,
            "new_value": proposal.new_value,
            "confidence": proposal.confidence,
            "requires_immediate_action": proposal.requires_immediate_action
        }

        # Include impact summary in response
        if simulation_summary:
            result["impact"] = simulation_summary

        return result

    async def process_multiple_updates(
        self,
        updates: List[Dict[str, Any]],
        jurisdiction: str = "US"
    ) -> List[Dict[str, Any]]:
        """
        Process multiple regulatory updates.

        Args:
            updates: List of update dicts with 'title', 'summary', 'raw_content'
            jurisdiction: Target jurisdiction

        Returns:
            List of results from process_update
        """
        results = []

        for update in updates:
            update_text = f"""
Title: {update.get('title', 'Unknown')}
Summary: {update.get('summary', '')}

Full Text:
{update.get('raw_content', update.get('summary', ''))}
"""
            result = await self.process_update(
                update_text=update_text,
                jurisdiction=jurisdiction,
                source_update=update
            )
            results.append(result)

        return results

    def _save_pending_change(self, change: PendingChange) -> None:
        """Save a pending change to file."""
        filename = self.pending_dir / f"{change.id}.json"
        with open(filename, 'w') as f:
            json.dump(change.to_dict(), f, indent=2)
        logger.info(f"Saved pending change to {filename}")

    def get_pending_changes(self, jurisdiction: Optional[str] = None) -> List[PendingChange]:
        """Get all pending changes, optionally filtered by jurisdiction."""
        changes = []

        for file in self.pending_dir.glob("chg_*.json"):
            try:
                with open(file, 'r') as f:
                    data = json.load(f)
                change = PendingChange.from_dict(data)

                if jurisdiction and change.jurisdiction != jurisdiction.upper():
                    continue

                if change.status == ChangeStatus.PENDING_REVIEW:
                    changes.append(change)
            except Exception as e:
                logger.error(f"Error loading pending change {file}: {e}")

        # Sort by creation date (newest first)
        changes.sort(key=lambda c: c.created_at, reverse=True)
        return changes

    def get_change_by_id(self, change_id: str) -> Optional[PendingChange]:
        """Get a specific pending change by ID."""
        filename = self.pending_dir / f"{change_id}.json"
        if not filename.exists():
            return None

        with open(filename, 'r') as f:
            data = json.load(f)
        return PendingChange.from_dict(data)

    def approve_change(
        self,
        change_id: str,
        reviewer: str,
        notes: Optional[str] = None,
        apply_immediately: bool = True
    ) -> Dict[str, Any]:
        """
        Approve a pending change.

        Args:
            change_id: ID of the change to approve
            reviewer: Name/ID of the reviewer
            notes: Optional review notes
            apply_immediately: Whether to apply the change now

        Returns:
            Result dict with status
        """
        change = self.get_change_by_id(change_id)
        if not change:
            return {"status": "error", "reason": f"Change {change_id} not found"}

        if change.status != ChangeStatus.PENDING_REVIEW:
            return {"status": "error", "reason": f"Change already processed: {change.status.value}"}

        # Update change status
        change.status = ChangeStatus.APPROVED
        change.reviewed_by = reviewer
        change.reviewed_at = datetime.now().isoformat()
        change.review_notes = notes

        # Apply if requested
        if apply_immediately:
            apply_result = self._apply_change(change)
            if apply_result["status"] == "applied":
                change.status = ChangeStatus.APPLIED
                change.applied_at = datetime.now().isoformat()

        # Save updated change
        self._save_pending_change(change)

        return {
            "status": "approved",
            "applied": apply_immediately and change.status == ChangeStatus.APPLIED,
            "change_id": change_id,
            "reviewer": reviewer
        }

    def reject_change(
        self,
        change_id: str,
        reviewer: str,
        reason: str
    ) -> Dict[str, Any]:
        """
        Reject a pending change.

        Args:
            change_id: ID of the change to reject
            reviewer: Name/ID of the reviewer
            reason: Reason for rejection

        Returns:
            Result dict with status
        """
        change = self.get_change_by_id(change_id)
        if not change:
            return {"status": "error", "reason": f"Change {change_id} not found"}

        if change.status != ChangeStatus.PENDING_REVIEW:
            return {"status": "error", "reason": f"Change already processed: {change.status.value}"}

        # Update change status
        change.status = ChangeStatus.REJECTED
        change.reviewed_by = reviewer
        change.reviewed_at = datetime.now().isoformat()
        change.review_notes = reason

        # Save updated change
        self._save_pending_change(change)

        logger.info(f"Change {change_id} rejected by {reviewer}: {reason}")

        return {
            "status": "rejected",
            "change_id": change_id,
            "reviewer": reviewer,
            "reason": reason
        }

    def _apply_change(self, change: PendingChange) -> Dict[str, Any]:
        """
        Apply an approved change to the ruleset.

        Args:
            change: The approved PendingChange to apply

        Returns:
            Result dict with status
        """
        proposal = change.proposal
        jurisdiction = change.jurisdiction

        try:
            # Load current rules
            rules = self._load_rules(jurisdiction)

            # Verify old value matches (safety check)
            current_value = self._get_nested_value(rules, proposal["field_path"])
            if current_value != proposal["old_value"]:
                logger.warning(
                    f"Old value mismatch for {proposal['field_path']}: "
                    f"expected {proposal['old_value']}, found {current_value}"
                )
                # Continue anyway but log the discrepancy

            # Apply the patch
            rules = self._apply_patch(rules, proposal["field_path"], proposal["new_value"])

            # Update metadata
            rules["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            rules["last_oracle_update"] = {
                "change_id": change.id,
                "field": proposal["field_path"],
                "old_value": proposal["old_value"],
                "new_value": proposal["new_value"],
                "applied_at": datetime.now().isoformat(),
                "reviewed_by": change.reviewed_by
            }

            # Bump version
            old_version = rules.get("version", "2024.01.01.001")
            new_version = f"{datetime.now().strftime('%Y.%m.%d')}.001"
            rules["version"] = new_version

            # Add to changelog
            changelog = rules.get("changelog", [])
            changelog.append({
                "date": datetime.now().isoformat(),
                "change_id": change.id,
                "field": proposal["field_path"],
                "old_value": proposal["old_value"],
                "new_value": proposal["new_value"],
                "summary": proposal["summary"],
                "source": "regulatory_oracle"
            })
            rules["changelog"] = changelog[-20:]  # Keep last 20

            # Save
            self._save_rules(jurisdiction, rules)

            logger.info(
                f"Applied change {change.id}: {proposal['field_path']} = {proposal['new_value']} "
                f"(version {old_version} -> {new_version})"
            )

            return {
                "status": "applied",
                "field_path": proposal["field_path"],
                "new_value": proposal["new_value"],
                "version": new_version
            }

        except Exception as e:
            logger.error(f"Failed to apply change {change.id}: {e}")
            return {"status": "error", "reason": str(e)}

    def get_change_history(self, jurisdiction: str, limit: int = 20) -> List[Dict]:
        """Get history of applied changes from the changelog."""
        try:
            rules = self._load_rules(jurisdiction)
            changelog = rules.get("changelog", [])
            return changelog[-limit:]
        except Exception:
            return []

    async def run_impact_simulation(
        self,
        change_id: str,
        use_live_data: bool = False
    ) -> Dict[str, Any]:
        """
        Run or re-run impact simulation for a pending change.

        This is the "God Mode" feature that shows what investors
        would be affected by a proposed rule change.

        Args:
            change_id: ID of the pending change
            use_live_data: If True, query real investor data

        Returns:
            Simulation result dict
        """
        change = self.get_change_by_id(change_id)
        if not change:
            return {"status": "error", "reason": f"Change {change_id} not found"}

        # Reconstruct the proposal
        proposal_data = change.proposal
        proposal = RegulatoryChangeProposal(
            is_relevant=proposal_data.get("is_relevant", True),
            confidence=proposal_data.get("confidence", 0.9),
            summary_of_change=proposal_data.get("summary", ""),
            target_file=proposal_data.get("target_file", ""),
            field_path=proposal_data.get("field_path", ""),
            old_value=proposal_data.get("old_value"),
            new_value=proposal_data.get("new_value"),
            reasoning=proposal_data.get("reasoning", ""),
            effective_date=proposal_data.get("effective_date"),
            requires_immediate_action=proposal_data.get("requires_immediate_action", False)
        )

        # Run simulation
        simulator = _get_simulator()
        result = await simulator.simulate_change(
            proposal,
            use_mock_data=not use_live_data
        )

        # Update the pending change with new simulation
        change.impact_simulation = result.to_dict()
        self._save_pending_change(change)

        logger.info(
            f"Simulation for {change_id}: {result.impacted_count} casualties, "
            f"severity={result.severity.value}"
        )

        return result.to_dict()


# Module-level convenience functions
_oracle: Optional[RegulatoryOracle] = None


def get_oracle() -> RegulatoryOracle:
    """Get or create the singleton Oracle instance."""
    global _oracle
    if _oracle is None:
        _oracle = RegulatoryOracle()
    return _oracle


async def process_regulatory_update(
    update_text: str,
    jurisdiction: str = "US",
    source_update: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Convenience function to process a regulatory update."""
    oracle = get_oracle()
    return await oracle.process_update(update_text, jurisdiction, source_update)
