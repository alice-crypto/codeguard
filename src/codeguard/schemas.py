"""Formats de sortie structurés demandés au modèle, et leur validation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from codeguard.config import SEVERITIES

Severity = Literal["critical", "high", "medium", "low", "info"]
Category = Literal[
    "bug",
    "security",
    "performance",
    "concurrency",
    "maintainability",
    "dead_code",
    "tests",
    "style",
]
Confidence = Literal["high", "medium", "low"]


class Finding(BaseModel):
    path: str
    line: int
    end_line: int
    severity: Severity
    category: Category
    confidence: Confidence
    title: str
    explanation: str
    suggested_code: str

    @property
    def severity_rank(self) -> int:
        return SEVERITIES.index(self.severity)


class ReviewOutput(BaseModel):
    summary: str
    findings: list[Finding]


class CleanChange(BaseModel):
    path: str
    kind: Literal[
        "dead_code", "duplication", "simplification", "naming", "comments", "imports", "other"
    ]
    description: str


class CleanOutput(BaseModel):
    summary: str
    changes: list[CleanChange]
    left_alone: list[str]


REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "severity": {"type": "string", "enum": list(SEVERITIES)},
                    "category": {
                        "type": "string",
                        "enum": [
                            "bug",
                            "security",
                            "performance",
                            "concurrency",
                            "maintainability",
                            "dead_code",
                            "tests",
                            "style",
                        ],
                    },
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "title": {"type": "string"},
                    "explanation": {"type": "string"},
                    "suggested_code": {"type": "string"},
                },
                "required": [
                    "path",
                    "line",
                    "end_line",
                    "severity",
                    "category",
                    "confidence",
                    "title",
                    "explanation",
                    "suggested_code",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "findings"],
    "additionalProperties": False,
}

CLEAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "dead_code",
                            "duplication",
                            "simplification",
                            "naming",
                            "comments",
                            "imports",
                            "other",
                        ],
                    },
                    "description": {"type": "string"},
                },
                "required": ["path", "kind", "description"],
                "additionalProperties": False,
            },
        },
        "left_alone": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "changes", "left_alone"],
    "additionalProperties": False,
}
