"""
AI Services

High-level orchestration services for AI-powered compliance.
"""

from .regulatory_oracle import (
    RegulatoryOracle,
    PendingChange,
    ChangeStatus,
    get_oracle,
    process_regulatory_update
)

from .impact_simulator import (
    RegulatoryImpactSimulator,
    SimulationResult,
    Casualty,
    TokenImpact,
    ImpactSeverity,
    GrandfatheringStrategy,
    get_simulator,
    simulate_proposal
)

__all__ = [
    # Oracle
    "RegulatoryOracle",
    "PendingChange",
    "ChangeStatus",
    "get_oracle",
    "process_regulatory_update",
    # Simulator - "God Mode"
    "RegulatoryImpactSimulator",
    "SimulationResult",
    "Casualty",
    "TokenImpact",
    "ImpactSeverity",
    "GrandfatheringStrategy",
    "get_simulator",
    "simulate_proposal",
]
