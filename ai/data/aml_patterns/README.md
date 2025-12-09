# AML Patterns Dataset

Training data for suspicious activity detection and risk scoring.

## Pattern Categories

### 1. High-Risk Transaction Patterns
- Structuring (smurfing)
- Rapid movement of funds
- Round-trip transactions
- Layering through multiple accounts

### 2. High-Risk Entity Indicators
- Shell company characteristics
- Complex ownership obscuring beneficial owners
- Nominees and proxies
- High-risk jurisdiction nexus

### 3. Behavioral Red Flags
- Unusual urgency
- Reluctance to provide information
- Inconsistent documentation
- Pattern changes after onboarding

## Risk Scoring Model

| Risk Level | Score Range | Action Required |
|------------|-------------|-----------------|
| Low | 0-25 | Standard monitoring |
| Medium | 26-50 | Enhanced due diligence |
| High | 51-75 | Senior review required |
| Critical | 76-100 | Block + SAR filing |

## Data Format

```json
{
  "pattern_id": "aml_001",
  "pattern_type": "structuring",
  "indicators": [
    "multiple_deposits_below_threshold",
    "same_day_different_branches",
    "round_amounts"
  ],
  "risk_score": 72,
  "recommended_action": "enhanced_due_diligence",
  "regulatory_reference": "FinCEN Advisory FIN-2014-A007"
}
```

## FATF High-Risk Jurisdictions

Updated list maintained at: `./fatf_high_risk.json`

Reference: https://www.fatf-gafi.org/en/publications/high-risk-and-other-monitored-jurisdictions.html

## Integration with Chainalysis/Elliptic

This dataset supplements but does not replace real-time screening via:
- Chainalysis KYT (Know Your Transaction)
- Elliptic Lens (wallet screening)
- ComplyAdvantage (PEP/sanctions lists)
