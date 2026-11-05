"""Rendu des rapports : texte, Markdown, JSON et SARIF."""

from __future__ import annotations

import json

from codeguard import __version__
from codeguard.clean import CleanReport
from codeguard.review import ReviewReport
from codeguard.schemas import Finding

_SARIF_LEVEL = {
    "critical": "error",
    "high": "error",
    "medium": "warning",
    "low": "note",
    "info": "note",
}


def _cost_line(usage, model: str) -> str:
    cost = usage.cost_usd(model)
    cost_text = f"~{cost:.2f} $ (estimation)" if cost is not None else "coût inconnu"
    return (
        f"{model} · {usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens} "
        f"jetons en entrée, {usage.output_tokens} en sortie · {cost_text}"
    )


def _location(finding: Finding) -> str:
    if finding.end_line != finding.line:
        return f"{finding.path}:{finding.line}-{finding.end_line}"
    return f"{finding.path}:{finding.line}"


def review_text(report: ReviewReport) -> str:
    lines = [f"Review : {report.target}", "", report.summary, ""]
    if report.partial:
        lines += ["⚠ Review incomplète : limite de tours ou de budget atteinte.", ""]
    if not report.findings:
        lines.append("Aucune remarque.")
    for finding in report.findings:
        lines.append(f"[{finding.severity.upper()}] {_location(finding)}  {finding.title}")
        lines.append(f"    {finding.explanation}")
        if finding.suggested_code:
            lines.append("    Suggestion :")
            lines.extend(f"      {line}" for line in finding.suggested_code.splitlines())
        lines.append("")
    if report.dropped:
        lines.append(f"{len(report.dropped)} remarque(s) écartée(s), lignes non vérifiables :")
        lines.extend(f"  - {item}" for item in report.dropped)
        lines.append("")
    if report.posted_url:
        lines.append(f"Publié sur GitHub : {report.posted_url}")
    lines.append(_cost_line(report.usage, report.model))
    return "\n".join(lines)


def review_markdown(report: ReviewReport) -> str:
    lines = [f"# Review : {report.target}", "", report.summary, ""]
    if report.partial:
        lines += ["> ⚠️ Review incomplète : limite de tours ou de budget atteinte.", ""]
    if not report.findings:
        lines.append("Aucune remarque.")
    for finding in report.findings:
        lines += [
            f"## {finding.severity.upper()} · `{_location(finding)}` · {finding.title}",
            "",
            finding.explanation,
            "",
        ]
        if finding.suggested_code:
            lines += ["```", finding.suggested_code.rstrip("\n"), "```", ""]
    if report.dropped:
        lines += ["## Remarques écartées (lignes non vérifiables)", ""]
        lines += [f"- {item}" for item in report.dropped]
        lines.append("")
    lines += ["---", _cost_line(report.usage, report.model)]
    return "\n".join(lines)


def review_json(report: ReviewReport) -> str:
    return json.dumps(
        {
            "target": report.target,
            "summary": report.summary,
            "partial": report.partial,
            "findings": [finding.model_dump() for finding in report.findings],
            "dropped": report.dropped,
            "posted_url": report.posted_url,
            "model": report.model,
            "usage": vars(report.usage),
            "estimated_cost_usd": report.usage.cost_usd(report.model),
        },
        ensure_ascii=False,
        indent=2,
    )


def review_sarif(report: ReviewReport) -> str:
    rules = sorted({finding.category for finding in report.findings})
    results = []
    for finding in report.findings:
        results.append(
            {
                "ruleId": finding.category,
                "level": _SARIF_LEVEL[finding.severity],
                "message": {"text": f"{finding.title}\n\n{finding.explanation}"},
                "locations": [
                    {
                        "physicalLocation": {
                            "artifactLocation": {"uri": finding.path},
                            "region": {"startLine": finding.line, "endLine": finding.end_line},
                        }
                    }
                ],
            }
        )
    return json.dumps(
        {
            "version": "2.1.0",
            "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
            "runs": [
                {
                    "tool": {
                        "driver": {
                            "name": "codeguard",
                            "version": __version__,
                            "rules": [{"id": rule} for rule in rules],
                        }
                    },
                    "results": results,
                }
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


RENDERERS = {
    "text": review_text,
    "markdown": review_markdown,
    "json": review_json,
    "sarif": review_sarif,
}


_CLEAN_STATUS = {
    "committed": "Nettoyage commité",
    "dry_run": "Aperçu (rien n'a été conservé)",
    "no_change": "Aucun changement",
    "checks_failed": "Vérifications en échec après nettoyage : rien n'a été commité",
    "baseline_failed": "Vérifications déjà en échec avant nettoyage : agent non lancé",
}


def clean_text(report: CleanReport) -> str:
    lines = [f"{_CLEAN_STATUS[report.status]} : {report.target}"]
    if report.summary:
        lines += ["", report.summary]
    if report.partial:
        lines += ["", "⚠ Nettoyage incomplet : limite de tours ou de budget atteinte."]
    if report.changes:
        lines += ["", "Changements :"]
        lines += [f"  - {item.path} [{item.kind}] {item.description}" for item in report.changes]
    if report.left_alone:
        lines += ["", "Laissé en l'état :"]
        lines += [f"  - {item}" for item in report.left_alone]
    if report.out_of_scope:
        lines += ["", "⚠ Fichiers modifiés hors périmètre (par un formateur) :"]
        lines += [f"  - {item}" for item in report.out_of_scope]
    if report.status in ("checks_failed", "baseline_failed") and report.checks_output:
        lines += ["", report.checks_output]
    if report.status == "dry_run" and report.diff:
        lines += ["", report.diff]
    if report.status == "committed":
        if report.checks_ran:
            lines += ["", "Vérifications : OK"]
        else:
            lines += ["", "⚠ Aucune vérification exécutée : relis le diff avant de fusionner."]
        lines += [
            "",
            f"Branche : {report.branch} ({report.commit[:10] if report.commit else ''})",
            f"  Voir :       git diff HEAD...{report.branch}",
            f"  Fusionner :  git merge --squash {report.branch}",
            f"  Abandonner : git branch -D {report.branch}",
        ]
    if report.worktree:
        lines += ["", f"Worktree conservé pour inspection : {report.worktree}"]
    if report.model:
        lines += ["", _cost_line(report.usage, report.model)]
    return "\n".join(lines)


def clean_json(report: CleanReport) -> dict:
    return {
        "target": report.target,
        "status": report.status,
        "status_label": _CLEAN_STATUS[report.status],
        "summary": report.summary,
        "partial": report.partial,
        "changes": [change.model_dump() for change in report.changes],
        "left_alone": report.left_alone,
        "out_of_scope": report.out_of_scope,
        "branch": report.branch,
        "commit": report.commit,
        "worktree": report.worktree,
        "diff": report.diff,
        "checks_ran": report.checks_ran,
        "checks_output": report.checks_output,
        "model": report.model,
        "usage": vars(report.usage),
        "estimated_cost_usd": report.usage.cost_usd(report.model) if report.model else None,
    }
