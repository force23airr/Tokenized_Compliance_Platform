"""
Synthetic Training Data Generation

This module generates training data for the AI compliance models.
"""

from .synthetic_generator import (
    generate_jurisdiction_dataset,
    generate_conflict_dataset,
)

__all__ = [
    "generate_jurisdiction_dataset",
    "generate_conflict_dataset",
]
