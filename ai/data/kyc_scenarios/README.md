# KYC Scenarios Dataset

Training data for investor identification and classification.

## Data Structure

Each scenario includes:
- **Input**: Document text, images, or structured data
- **Expected Output**: Jurisdiction, entity type, investor classification
- **Edge Cases**: Ambiguous or multi-jurisdiction situations

## Scenario Categories

### 1. Individual Investors
- US accredited (income-based)
- US accredited (net worth-based)
- EU professional (elective)
- Singapore accredited
- Multi-jurisdiction individuals

### 2. Entity Investors
- US corporations
- Offshore funds (Cayman, BVI)
- EU regulated entities
- Family offices
- Trusts

### 3. Complex Structures
- Feeder funds
- SPVs
- Nominee arrangements
- Joint accounts

## File Format

```json
{
  "scenario_id": "kyc_001",
  "input": {
    "documents": ["passport", "proof_of_address", "accreditation_letter"],
    "extracted_data": { ... }
  },
  "expected_output": {
    "jurisdiction": "US",
    "entity_type": "individual",
    "classification": "accredited",
    "confidence": 0.95
  },
  "reasoning": "Income verification letter from CPA confirms $250K annual income for past 2 years"
}
```

## Data Collection Guidelines

1. **Anonymize all PII** - No real names, SSNs, addresses
2. **Preserve structure** - Keep document formats realistic
3. **Include edge cases** - Borderline accreditation, unclear jurisdiction
4. **Label confidence** - How certain is the classification?
