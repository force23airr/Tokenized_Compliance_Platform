# AI Compliance Engine

AI-powered regulatory compliance automation for multi-jurisdiction RWA tokenization.

## Models

### Jurisdiction Classifier
Identifies investor jurisdiction, entity type, and applicable regulatory frameworks from onboarding documents.

### Conflict Resolver
Detects conflicting rules across jurisdictions and proposes compliant resolution paths (typically applying the strictest common standard).

### Document Generator
Generates compliant subscription documents, PPMs, and disclosures tailored to specific jurisdiction combinations.

## Architecture

```
Investor Docs → Jurisdiction Classifier → Rule Engine Lookup
                                              ↓
                                       Conflict Resolver
                                              ↓
                                       Document Generator → Compliant Outputs
```

## Base Models

Recommended foundation models for fine-tuning:
- **Mistral 7B** - General compliance reasoning
- **Legal-BERT** - Legal text classification
- **Phi-3** - Lightweight inference for edge deployment

## Training Data Sources

- SEC regulations (Reg D, Reg S, Reg A+)
- EU MiFID II / ESMA guidelines
- UK FCA rulebook
- Singapore MAS regulations
- Cayman CIMA requirements
- Historical legal opinions (anonymized)
- Subscription document templates
