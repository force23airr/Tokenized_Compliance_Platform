#!/usr/bin/env python3
"""
Synthetic Training Data Generator

Generates jurisdiction classification and conflict resolution training examples
based on SEC and MAS regulatory rules.
"""

import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Tuple

# Project paths
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
JURISDICTIONS_DIR = DATA_DIR / "jurisdictions"
OUTPUT_DIR = PROJECT_ROOT / "training" / "datasets"

# Ensure output directories exist
(OUTPUT_DIR / "jurisdiction").mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "conflicts").mkdir(parents=True, exist_ok=True)


# ============= US Templates =============

US_ACCREDITED_TEMPLATES = [
    {
        "document_type": "accreditation_letter",
        "text": "This letter certifies that {name} qualifies as an accredited investor under SEC Rule 501(a). The investor has demonstrated an annual income exceeding ${income:,} for the past two years and expects to maintain this level. Net worth excluding primary residence: ${net_worth:,}.",
        "jurisdiction": "US",
        "classification": "accredited",
        "entity_type": "individual",
    },
    {
        "document_type": "broker_verification",
        "text": "Accredited Investor Verification - Client: {name}, Social Security: XXX-XX-{ssn_last4}. Verification method: Income verification via tax returns. Annual income (2 year average): ${income:,}. Net worth (excluding primary residence): ${net_worth:,}. Status: ACCREDITED per Rule 501(a).",
        "jurisdiction": "US",
        "classification": "accredited",
        "entity_type": "individual",
    },
    {
        "document_type": "tax_form",
        "text": "Form W-2 Summary - Employee: {name}, Employer: {company}, Address: {address}, {city}, {state} {zip}. Wages: ${income:,}. Federal Tax Withheld: ${tax:,}. State: {state}. Year: 2024.",
        "jurisdiction": "US",
        "classification": "retail",  # W-2 alone doesn't prove accreditation
        "entity_type": "individual",
    },
]

US_QUALIFIED_PURCHASER_TEMPLATES = [
    {
        "document_type": "qualified_purchaser_cert",
        "text": "Qualified Purchaser Certification - I, {name}, hereby certify that I own investments of at least ${investments:,} (exceeding the $5,000,000 threshold) and qualify as a Qualified Purchaser under Section 2(a)(51) of the Investment Company Act.",
        "jurisdiction": "US",
        "classification": "qualified_purchaser",
        "entity_type": "individual",
    },
]

US_INSTITUTIONAL_TEMPLATES = [
    {
        "document_type": "institutional_cert",
        "text": "{company_name} certifies it is an institutional investor with assets under management of ${aum:,}. The firm is registered as a {firm_type} and maintains offices at {address}. Contact: {contact_name}, {title}.",
        "jurisdiction": "US",
        "classification": "institutional",
        "entity_type": "corporation",
    },
]

US_RETAIL_TEMPLATES = [
    {
        "document_type": "account_opening",
        "text": "Account Application - Name: {name}, Address: {address}, {city}, {state} {zip}. Employment: {job_title} at {company}. Annual Income: ${income:,}. Net Worth: ${net_worth:,}. Investment Experience: {experience}.",
        "jurisdiction": "US",
        "classification": "retail",
        "entity_type": "individual",
    },
]


# ============= Singapore Templates =============

SG_ACCREDITED_TEMPLATES = [
    {
        "document_type": "mas_accredited_cert",
        "text": "Accredited Investor Declaration (MAS SFA Section 4A) - I, {name}, NRIC: {nric}, declare that my net personal assets exceed SGD {net_assets:,} (equivalent to approximately USD {usd_equiv:,}). I understand the reduced regulatory protections.",
        "jurisdiction": "SG",
        "classification": "accredited_investor",
        "entity_type": "individual",
    },
    {
        "document_type": "bank_statement",
        "text": "DBS Bank Statement - Account Holder: {name}, Address: {address}, Singapore {postal}. Total Assets: SGD {total_assets:,}. Investment Portfolio: SGD {investments:,}. Cash Balance: SGD {cash:,}.",
        "jurisdiction": "SG",
        "classification": "accredited_investor",
        "entity_type": "individual",
    },
]

SG_EXPERT_TEMPLATES = [
    {
        "document_type": "expert_investor_cert",
        "text": "Expert Investor Certification - {name} is certified as an Expert Investor under MAS regulations. The investor has demonstrated the requisite knowledge and experience in capital markets. License: {license_number}.",
        "jurisdiction": "SG",
        "classification": "expert_investor",
        "entity_type": "individual",
    },
]

SG_INSTITUTIONAL_TEMPLATES = [
    {
        "document_type": "institutional_cert",
        "text": "{company_name} Pte Ltd, UEN: {uen}, is an institutional investor under MAS SFA. Registered office: {address}, Singapore. Net assets: SGD {assets:,}. The company holds a Capital Markets Services License.",
        "jurisdiction": "SG",
        "classification": "institutional_investor",
        "entity_type": "corporation",
    },
]

SG_RETAIL_TEMPLATES = [
    {
        "document_type": "cpf_statement",
        "text": "CPF Statement - Member: {name}, NRIC: {nric}. Ordinary Account: SGD {oa:,}. Special Account: SGD {sa:,}. Medisave: SGD {ma:,}. Total: SGD {total:,}. Address: {address}, Singapore {postal}.",
        "jurisdiction": "SG",
        "classification": "retail",
        "entity_type": "individual",
    },
]


# ============= UK/EU Templates =============

UK_PROFESSIONAL_TEMPLATES = [
    {
        "document_type": "professional_client_agreement",
        "text": "Professional Client Classification - {name} has been classified as a Professional Client under MiFID II. The client meets the quantitative threshold: portfolio size exceeds EUR {portfolio:,}, with {trades} significant transactions in the past year.",
        "jurisdiction": "GB",
        "classification": "professional",
        "entity_type": "individual",
    },
]


# ============= Data Generators =============

def generate_us_name() -> str:
    first_names = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]
    return f"{random.choice(first_names)} {random.choice(last_names)}"


def generate_sg_name() -> str:
    names = ["Tan Wei Ming", "Lee Mei Ling", "Lim Jun Wei", "Ng Hui Ying", "Wong Kai Lin", "Chen Xiu Mei", "Koh Jia Hui", "Ong Zi Xuan"]
    return random.choice(names)


def generate_company_name() -> str:
    prefixes = ["Alpha", "Beta", "Gamma", "Delta", "Omega", "Apex", "Summit", "Prime", "Elite", "Global"]
    suffixes = ["Capital", "Partners", "Investments", "Holdings", "Asset Management", "Ventures", "Financial"]
    return f"{random.choice(prefixes)} {random.choice(suffixes)}"


def generate_us_address() -> Dict[str, str]:
    streets = ["123 Main St", "456 Oak Ave", "789 Wall St", "321 Park Ave", "555 Broadway"]
    cities = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Francisco", "Boston"]
    states = ["NY", "CA", "IL", "TX", "AZ", "MA"]
    return {
        "address": random.choice(streets),
        "city": random.choice(cities),
        "state": random.choice(states),
        "zip": f"{random.randint(10000, 99999)}",
    }


def generate_sg_address() -> Dict[str, str]:
    streets = ["1 Raffles Place", "8 Marina Boulevard", "168 Robinson Road", "80 Anson Road", "9 Battery Road"]
    return {
        "address": random.choice(streets),
        "postal": f"{random.randint(18900, 99999):06d}",
    }


def fill_template(template: Dict[str, Any]) -> Dict[str, Any]:
    """Fill a template with generated data."""
    text = template["text"]

    # Generate names
    if "{name}" in text:
        if template["jurisdiction"] == "SG":
            text = text.replace("{name}", generate_sg_name())
        else:
            text = text.replace("{name}", generate_us_name())

    # Generate company names
    if "{company_name}" in text or "{company}" in text:
        company = generate_company_name()
        text = text.replace("{company_name}", company)
        text = text.replace("{company}", company)

    # Generate addresses
    if template["jurisdiction"] == "SG":
        addr = generate_sg_address()
        text = text.replace("{address}", addr["address"])
        text = text.replace("{postal}", addr["postal"])
    else:
        addr = generate_us_address()
        text = text.replace("{address}", addr.get("address", ""))
        text = text.replace("{city}", addr.get("city", ""))
        text = text.replace("{state}", addr.get("state", ""))
        text = text.replace("{zip}", addr.get("zip", ""))

    # Generate financial figures
    if template["classification"] in ["accredited", "accredited_investor"]:
        income = random.randint(250000, 2000000)
        net_worth = random.randint(1500000, 10000000)
    elif template["classification"] in ["qualified_purchaser"]:
        income = random.randint(500000, 5000000)
        net_worth = random.randint(5000000, 50000000)
    elif template["classification"] in ["institutional", "institutional_investor"]:
        income = random.randint(1000000, 100000000)
        net_worth = random.randint(10000000, 1000000000)
    else:
        income = random.randint(50000, 180000)
        net_worth = random.randint(100000, 800000)

    text = text.replace("{income:,}", f"{income:,}")
    text = text.replace("{net_worth:,}", f"{net_worth:,}")
    text = text.replace("{tax:,}", f"{int(income * 0.25):,}")

    # Singapore specific
    text = text.replace("{net_assets:,}", f"{random.randint(2500000, 10000000):,}")
    text = text.replace("{usd_equiv:,}", f"{random.randint(1800000, 7500000):,}")
    text = text.replace("{total_assets:,}", f"{random.randint(3000000, 15000000):,}")
    text = text.replace("{investments:,}", f"{random.randint(2000000, 10000000):,}")
    text = text.replace("{cash:,}", f"{random.randint(100000, 1000000):,}")
    text = text.replace("{oa:,}", f"{random.randint(50000, 300000):,}")
    text = text.replace("{sa:,}", f"{random.randint(30000, 200000):,}")
    text = text.replace("{ma:,}", f"{random.randint(20000, 100000):,}")
    text = text.replace("{total:,}", f"{random.randint(100000, 600000):,}")

    # Institutional specific
    text = text.replace("{aum:,}", f"{random.randint(100000000, 10000000000):,}")
    text = text.replace("{assets:,}", f"{random.randint(50000000, 500000000):,}")
    text = text.replace("{portfolio:,}", f"{random.randint(500000, 5000000):,}")

    # IDs and references
    text = text.replace("{ssn_last4}", f"{random.randint(1000, 9999)}")
    text = text.replace("{nric}", f"S{random.randint(1000000, 9999999)}{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[random.randint(0, 25)]}")
    text = text.replace("{uen}", f"{random.randint(100000000, 999999999)}")
    text = text.replace("{license_number}", f"CMS-{random.randint(10000, 99999)}")

    # Misc
    text = text.replace("{job_title}", random.choice(["Software Engineer", "Manager", "Director", "VP", "Analyst"]))
    text = text.replace("{experience}", random.choice(["Beginner", "Intermediate", "Advanced"]))
    text = text.replace("{firm_type}", random.choice(["Investment Advisor", "Broker-Dealer", "Hedge Fund"]))
    text = text.replace("{contact_name}", generate_us_name())
    text = text.replace("{title}", random.choice(["CEO", "CIO", "Managing Director", "Partner"]))
    text = text.replace("{trades}", str(random.randint(10, 50)))
    text = text.replace("{investments:,}", f"{random.randint(6000000, 50000000):,}")

    return {
        "document_text": text,
        "document_type": template["document_type"],
        "expected_output": {
            "jurisdiction": template["jurisdiction"],
            "entity_type": template["entity_type"],
            "investor_classification": template["classification"],
            "applicable_regulations": get_regulations(template["jurisdiction"], template["classification"]),
            "confidence": round(random.uniform(0.85, 0.98), 2),
        },
    }


def get_regulations(jurisdiction: str, classification: str) -> List[str]:
    """Get applicable regulations for jurisdiction/classification."""
    regulations = {
        ("US", "accredited"): ["SEC Rule 501(a)", "Regulation D 506(b)", "Regulation D 506(c)"],
        ("US", "qualified_purchaser"): ["SEC Rule 501(a)", "Investment Company Act Section 2(a)(51)", "Regulation D"],
        ("US", "institutional"): ["SEC Rule 501(a)", "Regulation D", "Rule 144A"],
        ("US", "retail"): ["Securities Act of 1933", "Regulation A"],
        ("SG", "accredited_investor"): ["MAS SFA Section 4A", "SFA Section 275"],
        ("SG", "expert_investor"): ["MAS SFA Section 4A", "SFA Section 305"],
        ("SG", "institutional_investor"): ["MAS SFA", "SFA Section 274", "Financial Institutions Act"],
        ("SG", "retail"): ["MAS SFA", "Securities and Futures Act"],
        ("GB", "professional"): ["MiFID II", "FCA COBS"],
        ("GB", "retail"): ["MiFID II", "FCA COBS", "Consumer Duty"],
    }
    return regulations.get((jurisdiction, classification), [])


def generate_jurisdiction_dataset(num_examples: int = 1000) -> List[Dict]:
    """Generate jurisdiction classification training examples."""
    all_templates = (
        US_ACCREDITED_TEMPLATES * 3 +  # Weight accredited higher
        US_QUALIFIED_PURCHASER_TEMPLATES +
        US_INSTITUTIONAL_TEMPLATES +
        US_RETAIL_TEMPLATES * 2 +
        SG_ACCREDITED_TEMPLATES * 3 +
        SG_EXPERT_TEMPLATES +
        SG_INSTITUTIONAL_TEMPLATES +
        SG_RETAIL_TEMPLATES * 2 +
        UK_PROFESSIONAL_TEMPLATES
    )

    examples = []
    for _ in range(num_examples):
        template = random.choice(all_templates)
        example = fill_template(template)
        examples.append(example)

    return examples


# ============= Conflict Scenarios =============

CONFLICT_SCENARIOS = [
    {
        "asset_type": "TREASURY",
        "issuer_jurisdiction": "US",
        "investor_jurisdictions": ["US", "SG"],
        "conflicts": [
            {
                "type": "accreditation_conflict",
                "jurisdictions": ["US", "SG"],
                "description": "US accreditation threshold ($1M net worth) differs from SG (SGD 2M ≈ $1.5M)",
                "rule_a": "SEC Rule 501(a): $1M net worth excluding primary residence",
                "rule_b": "MAS SFA 4A: SGD 2M net personal assets",
            }
        ],
        "resolution": {
            "strategy": "apply_strictest",
            "combined_requirements": {
                "accredited_only": True,
                "min_net_worth_usd": 1500000,
                "max_investors": 35,
                "lockup_days": 365,
            }
        }
    },
    {
        "asset_type": "PRIVATE_CREDIT",
        "issuer_jurisdiction": "US",
        "investor_jurisdictions": ["US", "SG"],
        "conflicts": [
            {
                "type": "investor_limit_conflict",
                "jurisdictions": ["US", "SG"],
                "description": "US Reg D 506(b) allows 35 non-accredited investors, SG Section 275 allows 50 total offerees",
                "rule_a": "Regulation D 506(b): Up to 35 non-accredited investors",
                "rule_b": "SFA Section 275(1A): Up to 50 offerees in 12 months",
            },
            {
                "type": "lockup_conflict",
                "jurisdictions": ["US", "SG"],
                "description": "US requires 6-12 month holding period, SG recommends 6 months",
                "rule_a": "Rule 144: 6-12 month holding period",
                "rule_b": "MAS: 6 month safe harbor recommended",
            }
        ],
        "resolution": {
            "strategy": "apply_strictest",
            "combined_requirements": {
                "accredited_only": True,
                "max_investors": 35,
                "lockup_days": 365,
                "required_disclosures": ["PPM", "Subscription Agreement", "Risk Disclosures"],
            }
        }
    },
    {
        "asset_type": "REAL_ESTATE",
        "issuer_jurisdiction": "SG",
        "investor_jurisdictions": ["US", "SG", "GB"],
        "conflicts": [
            {
                "type": "disclosure_conflict",
                "jurisdictions": ["US", "GB"],
                "description": "US requires Form D filing, UK requires FCA notification",
                "rule_a": "SEC: Form D filing within 15 days",
                "rule_b": "FCA: Notification for cross-border promotion",
            },
            {
                "type": "jurisdiction_conflict",
                "jurisdictions": ["US", "SG", "GB"],
                "description": "Multi-jurisdiction offering requires compliance with all regimes",
                "rule_a": "US SEC Reg D / Reg S for offshore",
                "rule_b": "MAS SFA + FCA cross-border rules",
            }
        ],
        "resolution": {
            "strategy": "jurisdiction_specific",
            "combined_requirements": {
                "accredited_only": True,
                "min_investment": 200000,
                "max_investors": 35,
                "lockup_days": 365,
                "required_disclosures": ["PPM", "Subscription Agreement", "Risk Disclosures", "Cross-Border Notice"],
                "filing_requirements": ["US Form D", "SG Section 275 Notice", "FCA Notification"],
            }
        }
    },
]


def generate_conflict_dataset(num_examples: int = 500) -> List[Dict]:
    """Generate conflict resolution training examples."""
    examples = []

    for _ in range(num_examples):
        scenario = random.choice(CONFLICT_SCENARIOS)

        # Add some variation
        varied_scenario = {
            "input": {
                "asset_type": scenario["asset_type"],
                "issuer_jurisdiction": scenario["issuer_jurisdiction"],
                "investor_jurisdictions": scenario["investor_jurisdictions"],
                "investor_types": random.sample(["accredited", "institutional", "professional"], k=random.randint(1, 2)),
            },
            "expected_output": {
                "has_conflicts": len(scenario["conflicts"]) > 0,
                "conflicts": scenario["conflicts"],
                "resolutions": [
                    {
                        "conflict_type": c["type"],
                        "strategy": scenario["resolution"]["strategy"],
                        "resolved_requirement": f"Apply {scenario['resolution']['strategy'].replace('_', ' ')} rule",
                        "rationale": f"To ensure compliance across {', '.join(scenario['investor_jurisdictions'])}"
                    }
                    for c in scenario["conflicts"]
                ],
                "combined_requirements": scenario["resolution"]["combined_requirements"],
                "confidence": round(random.uniform(0.82, 0.95), 2),
            }
        }

        examples.append(varied_scenario)

    return examples


# ============= Main Generation =============

def main():
    """Generate all training datasets."""
    print("Generating synthetic training data...")

    # Generate jurisdiction classification data
    print("\n1. Generating jurisdiction classification dataset...")
    jurisdiction_data = generate_jurisdiction_dataset(1200)

    # Split into train/val
    random.shuffle(jurisdiction_data)
    split_idx = int(len(jurisdiction_data) * 0.85)

    train_data = jurisdiction_data[:split_idx]
    val_data = jurisdiction_data[split_idx:]

    # Save jurisdiction data
    train_file = OUTPUT_DIR / "jurisdiction" / "train.jsonl"
    val_file = OUTPUT_DIR / "jurisdiction" / "val.jsonl"

    with open(train_file, 'w') as f:
        for item in train_data:
            f.write(json.dumps(item) + '\n')

    with open(val_file, 'w') as f:
        for item in val_data:
            f.write(json.dumps(item) + '\n')

    print(f"   - Train: {len(train_data)} examples -> {train_file}")
    print(f"   - Val: {len(val_data)} examples -> {val_file}")

    # Generate conflict resolution data
    print("\n2. Generating conflict resolution dataset...")
    conflict_data = generate_conflict_dataset(600)

    random.shuffle(conflict_data)
    split_idx = int(len(conflict_data) * 0.85)

    train_conflicts = conflict_data[:split_idx]
    val_conflicts = conflict_data[split_idx:]

    train_file = OUTPUT_DIR / "conflicts" / "train.jsonl"
    val_file = OUTPUT_DIR / "conflicts" / "val.jsonl"

    with open(train_file, 'w') as f:
        for item in train_conflicts:
            f.write(json.dumps(item) + '\n')

    with open(val_file, 'w') as f:
        for item in val_conflicts:
            f.write(json.dumps(item) + '\n')

    print(f"   - Train: {len(train_conflicts)} examples -> {train_file}")
    print(f"   - Val: {len(val_conflicts)} examples -> {val_file}")

    # Generate summary
    print("\n" + "=" * 50)
    print("Summary:")
    print(f"  Jurisdiction Classification: {len(jurisdiction_data)} total examples")
    print(f"  Conflict Resolution: {len(conflict_data)} total examples")
    print("=" * 50)


if __name__ == "__main__":
    main()
