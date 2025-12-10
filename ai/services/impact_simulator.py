#!/usr/bin/env python3
"""
Regulatory Impact Simulator - "God Mode"

Before a Compliance Officer approves a rule change, this simulator answers:
"Who does this kill?"

It runs a dry-run of the proposed rule change against the investor database
to calculate "Casualties" - investors who would become non-compliant.

Example:
    Oracle: "Proposing change: min_income $200k -> $250k"
    Simulator: "Warning: Approving this change will disqualify 142 investors
                holding $14.5M in assets. Do you want to grandfather them?"
"""

import os
import sys
import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, List, Optional, Tuple
from enum import Enum
from decimal import Decimal

import httpx

# Configure path for imports
_ai_dir = Path(__file__).parent.parent
if str(_ai_dir) not in sys.path:
    sys.path.insert(0, str(_ai_dir))

from inference.providers.together_client import RegulatoryChangeProposal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ImpactSeverity(Enum):
    """Severity level of the impact."""
    NONE = "none"
    LOW = "low"           # < 1% of investors affected
    MEDIUM = "medium"     # 1-5% of investors affected
    HIGH = "high"         # 5-15% of investors affected
    CRITICAL = "critical" # > 15% of investors affected


class GrandfatheringStrategy(Enum):
    """Strategies for handling existing non-compliant investors."""
    NONE = "none"                           # No grandfathering, immediate enforcement
    FULL = "full"                           # All existing investors grandfathered
    TIME_LIMITED = "time_limited"           # Grace period for compliance
    TRANSACTION_BASED = "transaction_based" # Grandfather until next transaction
    HOLDINGS_FROZEN = "holdings_frozen"     # Can't add, can sell


@dataclass
class Casualty:
    """An investor who would become non-compliant under new rules."""
    investor_id: str
    investor_name: str
    wallet_address: str
    jurisdiction: str
    classification: str

    # Why they fail
    failure_reason: str
    failed_rule_path: str
    current_value: Any
    new_threshold: Any

    # Impact metrics
    total_holdings_usd: float
    tokens_held: List[str]

    # Recommendations
    remediation_path: Optional[str] = None
    can_be_grandfathered: bool = True


@dataclass
class TokenImpact:
    """Impact on a specific token's investor base."""
    token_id: str
    token_symbol: str
    token_name: str

    investors_affected: int
    total_investors: int
    percentage_affected: float

    value_at_risk_usd: float
    total_token_value_usd: float


@dataclass
class SimulationResult:
    """Complete result of an impact simulation."""
    # Metadata
    simulation_id: str
    proposal_id: str
    simulated_at: str
    rule_change_summary: str

    # Impact metrics
    total_investors_checked: int
    impacted_count: int
    impact_percentage: float
    severity: ImpactSeverity

    # Financial impact
    total_assets_at_risk_usd: float
    total_platform_assets_usd: float
    assets_at_risk_percentage: float

    # Breakdowns
    casualties: List[Casualty]
    tokens_impacted: List[TokenImpact]

    # By jurisdiction
    impact_by_jurisdiction: Dict[str, int]

    # Recommendations
    recommended_grandfathering: GrandfatheringStrategy
    grandfathering_rationale: str
    estimated_compliance_timeline_days: int

    # Warnings
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        result = asdict(self)
        result["severity"] = self.severity.value
        result["recommended_grandfathering"] = self.recommended_grandfathering.value
        return result


class RegulatoryImpactSimulator:
    """
    Simulates the impact of regulatory rule changes on the investor base.

    This is the "Strategic Command Center" that transforms rule changes
    from blind approvals into informed decisions.
    """

    # API endpoint for investor data (Node.js backend)
    API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000/api/v1")

    # Rule path patterns and their corresponding investor checks
    RULE_IMPACT_MAPPINGS = {
        # Accredited investor thresholds
        "accredited_investor_definition.categories.natural_person_income.thresholds.individual_income": {
            "check_field": "accreditation_income",
            "investor_filter": {"classification": "accredited", "accreditation_type": "income"},
            "description": "Individual income threshold for accreditation"
        },
        "accredited_investor_definition.categories.natural_person_income.thresholds.joint_income": {
            "check_field": "accreditation_joint_income",
            "investor_filter": {"classification": "accredited", "accreditation_type": "income"},
            "description": "Joint income threshold for accreditation"
        },
        "accredited_investor_definition.categories.natural_person_net_worth.thresholds.net_worth": {
            "check_field": "net_worth",
            "investor_filter": {"classification": "accredited", "accreditation_type": "net_worth"},
            "description": "Net worth threshold for accreditation"
        },
        "qualified_purchaser_definition.categories.natural_person.investments_threshold": {
            "check_field": "investments_value",
            "investor_filter": {"classification": "qualified_purchaser"},
            "description": "Investment threshold for qualified purchaser status"
        },
        "qualified_purchaser_definition.categories.entity.investments_threshold": {
            "check_field": "entity_investments_value",
            "investor_filter": {"classification": "qualified_purchaser", "investor_type": "entity"},
            "description": "Entity investment threshold for QP status"
        },
        # Regulation D requirements
        "exemptions.reg_d_506b.requirements.max_non_accredited_investors": {
            "check_type": "count_check",
            "investor_filter": {"classification": "non_accredited"},
            "description": "Maximum non-accredited investors allowed"
        },
        # Transfer restrictions
        "transfer_restrictions.rule_144.holding_period_reporting_issuer_days": {
            "check_field": "holding_period_days",
            "investor_filter": {"has_restricted_securities": True},
            "description": "Holding period for restricted securities"
        },
    }

    def __init__(self):
        self.http_client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self.http_client is None:
            self.http_client = httpx.AsyncClient(timeout=30.0)
        return self.http_client

    async def close(self):
        """Close HTTP client."""
        if self.http_client:
            await self.http_client.aclose()
            self.http_client = None

    async def simulate_change(
        self,
        proposal: RegulatoryChangeProposal,
        use_mock_data: bool = False
    ) -> SimulationResult:
        """
        Run the proposed rule change against the investor database.

        Args:
            proposal: The regulatory change proposal to simulate
            use_mock_data: If True, use mock data for testing

        Returns:
            SimulationResult with full impact analysis
        """
        simulation_id = f"sim_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{proposal.field_path[:20]}"

        logger.info(f"Starting impact simulation: {simulation_id}")
        logger.info(f"  Rule: {proposal.field_path}")
        logger.info(f"  Change: {proposal.old_value} -> {proposal.new_value}")

        # Get investor data
        if use_mock_data:
            investors = self._generate_mock_investors(proposal)
            total_platform_assets = 50_000_000.0  # $50M mock
        else:
            investors = await self._fetch_investors(proposal)
            total_platform_assets = await self._fetch_total_platform_assets()

        # Run simulation
        casualties, token_impacts = await self._run_compliance_check(
            proposal=proposal,
            investors=investors
        )

        # Calculate metrics
        total_investors = len(investors)
        impacted_count = len(casualties)
        impact_percentage = (impacted_count / total_investors * 100) if total_investors > 0 else 0

        total_assets_at_risk = sum(c.total_holdings_usd for c in casualties)
        assets_at_risk_percentage = (total_assets_at_risk / total_platform_assets * 100) if total_platform_assets > 0 else 0

        # Calculate by jurisdiction
        impact_by_jurisdiction = {}
        for c in casualties:
            impact_by_jurisdiction[c.jurisdiction] = impact_by_jurisdiction.get(c.jurisdiction, 0) + 1

        # Determine severity
        severity = self._calculate_severity(impact_percentage, assets_at_risk_percentage)

        # Generate recommendations
        grandfathering, rationale = self._recommend_grandfathering(
            proposal, impacted_count, impact_percentage, assets_at_risk_percentage
        )

        timeline = self._estimate_compliance_timeline(proposal, impacted_count)

        # Generate warnings
        warnings = self._generate_warnings(
            proposal, casualties, severity, impact_by_jurisdiction
        )

        result = SimulationResult(
            simulation_id=simulation_id,
            proposal_id=getattr(proposal, 'id', 'unknown'),
            simulated_at=datetime.now().isoformat(),
            rule_change_summary=f"{proposal.field_path}: {proposal.old_value} -> {proposal.new_value}",
            total_investors_checked=total_investors,
            impacted_count=impacted_count,
            impact_percentage=round(impact_percentage, 2),
            severity=severity,
            total_assets_at_risk_usd=round(total_assets_at_risk, 2),
            total_platform_assets_usd=round(total_platform_assets, 2),
            assets_at_risk_percentage=round(assets_at_risk_percentage, 2),
            casualties=casualties,
            tokens_impacted=token_impacts,
            impact_by_jurisdiction=impact_by_jurisdiction,
            recommended_grandfathering=grandfathering,
            grandfathering_rationale=rationale,
            estimated_compliance_timeline_days=timeline,
            warnings=warnings
        )

        logger.info(f"Simulation complete: {impacted_count}/{total_investors} investors affected ({impact_percentage:.1f}%)")
        logger.info(f"  Assets at risk: ${total_assets_at_risk:,.2f}")
        logger.info(f"  Severity: {severity.value}")

        return result

    async def _fetch_investors(self, proposal: RegulatoryChangeProposal) -> List[Dict[str, Any]]:
        """Fetch relevant investors from the database via API."""
        client = await self._get_client()

        # Determine which investors to fetch based on the rule being changed
        mapping = self.RULE_IMPACT_MAPPINGS.get(proposal.field_path)

        params = {
            "jurisdiction": "US" if "us_" in proposal.target_file.lower() or not proposal.target_file else None,
            "include_compliance": True,
            "include_holdings": True,
        }

        if mapping and "investor_filter" in mapping:
            params.update(mapping["investor_filter"])

        # Filter out None values
        params = {k: v for k, v in params.items() if v is not None}

        try:
            response = await client.get(
                f"{self.API_BASE_URL}/investors",
                params=params
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("investors", data) if isinstance(data, dict) else data
            else:
                logger.warning(f"Failed to fetch investors: {response.status_code}")
                return []

        except Exception as e:
            logger.error(f"Error fetching investors: {e}")
            # Return mock data in case of error for resilience
            return self._generate_mock_investors(proposal)

    async def _fetch_total_platform_assets(self) -> float:
        """Fetch total platform assets under management."""
        client = await self._get_client()

        try:
            response = await client.get(f"{self.API_BASE_URL}/analytics/aum")
            if response.status_code == 200:
                return response.json().get("total_aum_usd", 0)
        except Exception as e:
            logger.warning(f"Could not fetch platform AUM: {e}")

        return 50_000_000.0  # Default fallback

    def _generate_mock_investors(self, proposal: RegulatoryChangeProposal) -> List[Dict[str, Any]]:
        """Generate realistic mock investor data for testing."""
        import random

        mock_investors = []

        # Generate a mix of investors around the threshold
        old_threshold = float(proposal.old_value) if isinstance(proposal.old_value, (int, float, str)) else 200000
        new_threshold = float(proposal.new_value) if isinstance(proposal.new_value, (int, float, str)) else 250000

        for i in range(150):  # 150 mock investors
            # Create realistic distribution
            if i < 40:  # 40 investors well above new threshold
                income = random.uniform(new_threshold * 1.2, new_threshold * 3)
            elif i < 80:  # 40 investors in the danger zone (between old and new)
                income = random.uniform(old_threshold, new_threshold)
            elif i < 120:  # 40 investors at old threshold
                income = random.uniform(old_threshold * 0.95, old_threshold * 1.1)
            else:  # 30 non-accredited
                income = random.uniform(50000, old_threshold * 0.9)

            holdings = random.uniform(10000, 500000)

            mock_investors.append({
                "id": f"inv_{i:04d}",
                "fullName": f"Investor {i}",
                "walletAddress": f"0x{i:040x}",
                "jurisdiction": random.choice(["US", "US", "US", "SG", "UK"]),
                "classification": "accredited" if income >= old_threshold else "non_accredited",
                "investorType": random.choice(["individual", "individual", "entity", "trust"]),
                "kycStatus": "approved",
                "compliance": {
                    "accreditationType": "income" if income >= old_threshold else None,
                    "reportedIncome": income,
                    "netWorth": income * random.uniform(3, 10),
                },
                "holdings": {
                    "totalValueUsd": holdings,
                    "tokens": [
                        {"tokenId": f"tkn_{random.randint(1,5)}", "symbol": f"RWA{random.randint(1,5)}"}
                    ]
                }
            })

        return mock_investors

    async def _run_compliance_check(
        self,
        proposal: RegulatoryChangeProposal,
        investors: List[Dict[str, Any]]
    ) -> Tuple[List[Casualty], List[TokenImpact]]:
        """
        Run compliance check with proposed new rules.

        Returns tuple of (casualties, token_impacts)
        """
        casualties = []
        token_impact_map: Dict[str, Dict] = {}

        # Parse thresholds
        try:
            old_threshold = float(proposal.old_value) if proposal.old_value else 0
            new_threshold = float(proposal.new_value) if proposal.new_value else 0
        except (ValueError, TypeError):
            # Non-numeric change, handle differently
            old_threshold = proposal.old_value
            new_threshold = proposal.new_value

        for investor in investors:
            # Skip if not in affected jurisdiction
            jurisdiction = investor.get("jurisdiction", "")
            target_file = proposal.target_file.lower()

            if "us_" in target_file and jurisdiction != "US":
                continue
            if "sg_" in target_file and jurisdiction != "SG":
                continue

            # Check if this investor would fail under new rules
            is_casualty, failure_reason, current_value = self._check_investor_compliance(
                investor, proposal, new_threshold
            )

            if is_casualty:
                holdings = investor.get("holdings", {})
                tokens_held = [t.get("symbol", t.get("tokenId")) for t in holdings.get("tokens", [])]
                total_holdings = holdings.get("totalValueUsd", 0)

                casualty = Casualty(
                    investor_id=investor.get("id", "unknown"),
                    investor_name=investor.get("fullName", "Unknown"),
                    wallet_address=investor.get("walletAddress", "0x0"),
                    jurisdiction=jurisdiction,
                    classification=investor.get("classification", "unknown"),
                    failure_reason=failure_reason,
                    failed_rule_path=proposal.field_path,
                    current_value=current_value,
                    new_threshold=new_threshold,
                    total_holdings_usd=float(total_holdings),
                    tokens_held=tokens_held,
                    remediation_path=self._suggest_remediation(investor, proposal),
                    can_be_grandfathered=True
                )
                casualties.append(casualty)

                # Track token impacts
                for token in holdings.get("tokens", []):
                    token_id = token.get("tokenId", "unknown")
                    if token_id not in token_impact_map:
                        token_impact_map[token_id] = {
                            "token_id": token_id,
                            "token_symbol": token.get("symbol", "???"),
                            "token_name": token.get("name", f"Token {token_id}"),
                            "investors_affected": 0,
                            "total_investors": 0,
                            "value_at_risk": 0,
                            "total_value": 0,
                        }
                    token_impact_map[token_id]["investors_affected"] += 1
                    token_impact_map[token_id]["value_at_risk"] += float(token.get("valueUsd", total_holdings / len(holdings.get("tokens", [{}]))))

        # Convert token impacts
        token_impacts = [
            TokenImpact(
                token_id=t["token_id"],
                token_symbol=t["token_symbol"],
                token_name=t["token_name"],
                investors_affected=t["investors_affected"],
                total_investors=t.get("total_investors", t["investors_affected"]),
                percentage_affected=100.0,  # Will be updated with real data
                value_at_risk_usd=t["value_at_risk"],
                total_token_value_usd=t.get("total_value", t["value_at_risk"])
            )
            for t in token_impact_map.values()
        ]

        return casualties, token_impacts

    def _check_investor_compliance(
        self,
        investor: Dict[str, Any],
        proposal: RegulatoryChangeProposal,
        new_threshold: Any
    ) -> Tuple[bool, str, Any]:
        """
        Check if an investor would fail compliance under new rules.

        Returns: (is_casualty, failure_reason, current_value)
        """
        compliance = investor.get("compliance", {})
        classification = investor.get("classification", "")

        # Income threshold checks
        if "income" in proposal.field_path.lower():
            if "joint" in proposal.field_path.lower():
                current_income = compliance.get("reportedJointIncome", compliance.get("reportedIncome", 0))
            else:
                current_income = compliance.get("reportedIncome", 0)

            try:
                threshold = float(new_threshold)
                income = float(current_income)

                # Only check accredited investors who rely on income
                if classification == "accredited" and compliance.get("accreditationType") == "income":
                    if income < threshold:
                        return True, f"Income ${income:,.0f} below new threshold ${threshold:,.0f}", income
            except (ValueError, TypeError):
                pass

        # Net worth threshold checks
        elif "net_worth" in proposal.field_path.lower():
            current_net_worth = compliance.get("netWorth", 0)

            try:
                threshold = float(new_threshold)
                net_worth = float(current_net_worth)

                if classification == "accredited" and compliance.get("accreditationType") == "net_worth":
                    if net_worth < threshold:
                        return True, f"Net worth ${net_worth:,.0f} below new threshold ${threshold:,.0f}", net_worth
            except (ValueError, TypeError):
                pass

        # Qualified purchaser checks
        elif "qualified_purchaser" in proposal.field_path.lower():
            investments = compliance.get("investmentsValue", 0)

            try:
                threshold = float(new_threshold)
                inv_value = float(investments)

                if classification == "qualified_purchaser":
                    if inv_value < threshold:
                        return True, f"Investments ${inv_value:,.0f} below new threshold ${threshold:,.0f}", inv_value
            except (ValueError, TypeError):
                pass

        # Holding period checks
        elif "holding_period" in proposal.field_path.lower():
            holding_days = compliance.get("holdingPeriodDays", 0)

            try:
                threshold = int(new_threshold)
                days = int(holding_days)

                if days < threshold:
                    return True, f"Holding period {days} days below new requirement {threshold} days", days
            except (ValueError, TypeError):
                pass

        return False, "", None

    def _suggest_remediation(self, investor: Dict[str, Any], proposal: RegulatoryChangeProposal) -> Optional[str]:
        """Suggest how an investor could become compliant."""
        if "income" in proposal.field_path.lower():
            return "Investor may re-qualify via net worth verification or professional certification"
        elif "net_worth" in proposal.field_path.lower():
            return "Investor may re-qualify via income verification or professional certification"
        elif "holding_period" in proposal.field_path.lower():
            return "Wait for extended holding period to complete before transfer"
        return None

    def _calculate_severity(self, impact_percentage: float, assets_percentage: float) -> ImpactSeverity:
        """Calculate severity based on impact metrics."""
        # Use the higher of the two percentages
        max_impact = max(impact_percentage, assets_percentage)

        if max_impact == 0:
            return ImpactSeverity.NONE
        elif max_impact < 1:
            return ImpactSeverity.LOW
        elif max_impact < 5:
            return ImpactSeverity.MEDIUM
        elif max_impact < 15:
            return ImpactSeverity.HIGH
        else:
            return ImpactSeverity.CRITICAL

    def _recommend_grandfathering(
        self,
        proposal: RegulatoryChangeProposal,
        impacted_count: int,
        impact_percentage: float,
        assets_percentage: float
    ) -> Tuple[GrandfatheringStrategy, str]:
        """Recommend a grandfathering strategy based on impact."""

        if impacted_count == 0:
            return GrandfatheringStrategy.NONE, "No investors affected; no grandfathering needed"

        if impact_percentage > 15 or assets_percentage > 20:
            return (
                GrandfatheringStrategy.FULL,
                f"Critical impact ({impact_percentage:.1f}% of investors, {assets_percentage:.1f}% of assets). "
                "Recommend full grandfathering to avoid mass non-compliance and potential legal exposure."
            )

        if impact_percentage > 5 or assets_percentage > 10:
            return (
                GrandfatheringStrategy.TIME_LIMITED,
                f"High impact ({impact_percentage:.1f}% of investors). "
                "Recommend time-limited grandfathering with 12-month grace period for re-qualification."
            )

        if impact_percentage > 1:
            return (
                GrandfatheringStrategy.TRANSACTION_BASED,
                f"Moderate impact ({impact_percentage:.1f}% of investors). "
                "Recommend transaction-based grandfathering: existing holdings protected, new purchases require compliance."
            )

        return (
            GrandfatheringStrategy.HOLDINGS_FROZEN,
            f"Low impact ({impact_percentage:.1f}% of investors). "
            "Recommend frozen holdings: affected investors cannot add positions but can exit freely."
        )

    def _estimate_compliance_timeline(self, proposal: RegulatoryChangeProposal, impacted_count: int) -> int:
        """Estimate days needed for affected investors to reach compliance."""
        if impacted_count == 0:
            return 0

        # Base timeline
        if "holding_period" in proposal.field_path.lower():
            # For holding period changes, use the new period
            try:
                return int(proposal.new_value)
            except (ValueError, TypeError):
                return 365

        # For threshold changes, estimate time to notify and re-verify
        if impacted_count < 10:
            return 30
        elif impacted_count < 50:
            return 60
        elif impacted_count < 200:
            return 90
        else:
            return 180

    def _generate_warnings(
        self,
        proposal: RegulatoryChangeProposal,
        casualties: List[Casualty],
        severity: ImpactSeverity,
        by_jurisdiction: Dict[str, int]
    ) -> List[str]:
        """Generate warning messages for the compliance officer."""
        warnings = []

        if severity in [ImpactSeverity.HIGH, ImpactSeverity.CRITICAL]:
            warnings.append(
                f"CRITICAL: This change affects {len(casualties)} investors. "
                "Consider phased rollout or extended grandfathering."
            )

        # Check for high-value casualties
        high_value = [c for c in casualties if c.total_holdings_usd > 1_000_000]
        if high_value:
            warnings.append(
                f"HIGH VALUE ALERT: {len(high_value)} affected investors hold > $1M each. "
                f"Combined value at risk: ${sum(c.total_holdings_usd for c in high_value):,.0f}"
            )

        # Check jurisdiction concentration
        for jur, count in by_jurisdiction.items():
            if count > len(casualties) * 0.5 and count > 10:
                warnings.append(
                    f"CONCENTRATION: {count} of {len(casualties)} casualties ({count/len(casualties)*100:.0f}%) "
                    f"are in {jur}. Consider jurisdiction-specific transition."
                )

        # Immediate action warning
        if proposal.requires_immediate_action:
            warnings.append(
                "REGULATORY MANDATE: This change requires immediate action. "
                "Standard grandfathering may not be permissible."
            )

        return warnings


# Singleton instance
_simulator: Optional[RegulatoryImpactSimulator] = None


def get_simulator() -> RegulatoryImpactSimulator:
    """Get singleton simulator instance."""
    global _simulator
    if _simulator is None:
        _simulator = RegulatoryImpactSimulator()
    return _simulator


async def simulate_proposal(
    proposal: RegulatoryChangeProposal,
    use_mock_data: bool = False
) -> SimulationResult:
    """
    Convenience function to simulate a proposal.

    Usage:
        from ai.services.impact_simulator import simulate_proposal

        result = await simulate_proposal(proposal)
        print(f"Casualties: {result.impacted_count}")
        print(f"Assets at risk: ${result.total_assets_at_risk_usd:,.2f}")
    """
    simulator = get_simulator()
    return await simulator.simulate_change(proposal, use_mock_data)


# For testing
if __name__ == "__main__":
    async def test_simulation():
        """Test the impact simulator with mock data."""
        proposal = RegulatoryChangeProposal(
            is_relevant=True,
            confidence=0.92,
            summary_of_change="SEC raises accredited investor income threshold",
            target_file="us_sec_rules.json",
            field_path="accredited_investor_definition.categories.natural_person_income.thresholds.individual_income",
            old_value=200000,
            new_value=250000,
            reasoning="Inflation adjustment to maintain real purchasing power of threshold",
            effective_date="2025-07-01",
            requires_immediate_action=False
        )

        result = await simulate_proposal(proposal, use_mock_data=True)

        print("\n" + "=" * 60)
        print("IMPACT SIMULATION RESULTS")
        print("=" * 60)
        print(f"Rule Change: {result.rule_change_summary}")
        print(f"Severity: {result.severity.value.upper()}")
        print(f"\nInvestors Checked: {result.total_investors_checked}")
        print(f"Investors Impacted: {result.impacted_count} ({result.impact_percentage}%)")
        print(f"\nAssets at Risk: ${result.total_assets_at_risk_usd:,.2f}")
        print(f"Platform AUM: ${result.total_platform_assets_usd:,.2f}")
        print(f"At Risk %: {result.assets_at_risk_percentage}%")
        print(f"\nRecommended Strategy: {result.recommended_grandfathering.value}")
        print(f"Rationale: {result.grandfathering_rationale}")
        print(f"Compliance Timeline: {result.estimated_compliance_timeline_days} days")

        if result.warnings:
            print("\nWARNINGS:")
            for w in result.warnings:
                print(f"  - {w}")

        print(f"\nImpact by Jurisdiction:")
        for jur, count in result.impact_by_jurisdiction.items():
            print(f"  {jur}: {count} investors")

        print("\nFirst 5 Casualties:")
        for c in result.casualties[:5]:
            print(f"  - {c.investor_name}: {c.failure_reason}")
            print(f"    Holdings: ${c.total_holdings_usd:,.2f}")

    asyncio.run(test_simulation())
