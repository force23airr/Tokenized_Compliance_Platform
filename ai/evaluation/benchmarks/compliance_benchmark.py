#!/usr/bin/env python3
"""
Compliance AI Benchmark Suite
Evaluates model accuracy against known regulatory scenarios.
"""

import json
from pathlib import Path
from typing import List, Dict
from dataclasses import dataclass

@dataclass
class BenchmarkCase:
    """A single benchmark test case."""
    id: str
    category: str
    description: str
    input_data: dict
    expected_output: dict
    difficulty: str  # easy, medium, hard
    source: str  # regulation reference

class ComplianceBenchmark:
    """Benchmark suite for compliance AI models."""

    def __init__(self):
        self.test_cases: List[BenchmarkCase] = []
        self.results: Dict[str, dict] = {}

    def load_test_cases(self, path: str):
        """Load benchmark cases from JSON file."""
        with open(path, 'r') as f:
            data = json.load(f)

        for case in data["cases"]:
            self.test_cases.append(BenchmarkCase(**case))

    def run_jurisdiction_benchmark(self, model_fn) -> dict:
        """
        Benchmark jurisdiction classifier.

        Args:
            model_fn: Function that takes document text and returns classification
        """
        correct = 0
        total = 0
        results_by_difficulty = {"easy": [], "medium": [], "hard": []}

        jurisdiction_cases = [c for c in self.test_cases if c.category == "jurisdiction"]

        for case in jurisdiction_cases:
            prediction = model_fn(case.input_data["document_text"])
            expected = case.expected_output

            is_correct = (
                prediction.get("jurisdiction") == expected.get("jurisdiction") and
                prediction.get("entity_type") == expected.get("entity_type") and
                prediction.get("investor_classification") == expected.get("investor_classification")
            )

            if is_correct:
                correct += 1

            total += 1
            results_by_difficulty[case.difficulty].append(is_correct)

        return {
            "accuracy": correct / total if total > 0 else 0,
            "total_cases": total,
            "correct": correct,
            "by_difficulty": {
                k: sum(v) / len(v) if v else 0
                for k, v in results_by_difficulty.items()
            }
        }

    def run_conflict_benchmark(self, model_fn) -> dict:
        """
        Benchmark conflict resolver.

        Args:
            model_fn: Function that takes jurisdictions and returns conflicts/resolutions
        """
        conflict_cases = [c for c in self.test_cases if c.category == "conflict"]

        detection_correct = 0
        resolution_valid = 0
        total = 0

        for case in conflict_cases:
            prediction = model_fn(
                case.input_data["jurisdictions"],
                case.input_data["asset_type"]
            )
            expected = case.expected_output

            # Check conflict detection
            if prediction.get("has_conflicts") == expected.get("has_conflicts"):
                detection_correct += 1

            # Check resolution validity (simplified)
            pred_resolutions = set(r.get("strategy") for r in prediction.get("resolutions", []))
            exp_resolutions = set(r.get("strategy") for r in expected.get("resolutions", []))

            if pred_resolutions == exp_resolutions:
                resolution_valid += 1

            total += 1

        return {
            "conflict_detection_accuracy": detection_correct / total if total > 0 else 0,
            "resolution_validity": resolution_valid / total if total > 0 else 0,
            "total_cases": total
        }

    def generate_report(self) -> str:
        """Generate markdown benchmark report."""
        report = "# Compliance AI Benchmark Report\n\n"

        for task, result in self.results.items():
            report += f"## {task}\n\n"
            for metric, value in result.items():
                if isinstance(value, float):
                    report += f"- **{metric}**: {value:.2%}\n"
                elif isinstance(value, dict):
                    report += f"- **{metric}**:\n"
                    for k, v in value.items():
                        report += f"  - {k}: {v:.2%}\n"
                else:
                    report += f"- **{metric}**: {value}\n"
            report += "\n"

        return report


# Sample benchmark cases
SAMPLE_CASES = {
    "cases": [
        {
            "id": "jur_001",
            "category": "jurisdiction",
            "description": "US accredited investor identification",
            "input_data": {
                "document_text": "Form W-9 showing SSN 123-45-6789, address: 123 Main St, New York, NY 10001. Annual income: $250,000. Net worth: $1,500,000.",
                "document_type": "tax_form"
            },
            "expected_output": {
                "jurisdiction": "US",
                "entity_type": "individual",
                "investor_classification": "accredited",
                "applicable_regulations": ["SEC Reg D 501(a)"]
            },
            "difficulty": "easy",
            "source": "SEC Rule 501(a)"
        },
        {
            "id": "conf_001",
            "category": "conflict",
            "description": "US-UK accreditation conflict",
            "input_data": {
                "jurisdictions": ["US", "UK"],
                "asset_type": "PRIVATE_CREDIT",
                "investor_types": ["accredited", "professional"]
            },
            "expected_output": {
                "has_conflicts": True,
                "conflicts": [
                    {
                        "type": "accreditation_definition",
                        "description": "US and UK have different accreditation thresholds"
                    }
                ],
                "resolutions": [
                    {
                        "strategy": "apply_strictest",
                        "resolved_requirement": "Meet both US accredited and UK professional investor standards"
                    }
                ]
            },
            "difficulty": "medium",
            "source": "SEC Reg D, FCA COBS 3.5"
        }
    ]
}

if __name__ == "__main__":
    # Example usage
    benchmark = ComplianceBenchmark()

    # Save sample cases
    cases_path = Path(__file__).parent / "test-cases" / "sample_cases.json"
    cases_path.parent.mkdir(exist_ok=True)

    with open(cases_path, 'w') as f:
        json.dump(SAMPLE_CASES, f, indent=2)

    print(f"Sample benchmark cases saved to {cases_path}")
