"""Orchestration du nettoyage, toujours dans un worktree isolé.

L'arbre de travail de l'utilisateur n'est jamais modifié : le résultat est un commit sur une
branche dédiée, et les vérifications sont rejouées ici, indépendamment de ce qu'affirme le modèle.
"""

from __future__ import annotations

import secrets
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from codeguard import gitops
from codeguard.agent import AgentSettings, Usage, run_agent
from codeguard.config import Config, is_sensitive
from codeguard.prompts import clean_prompt, clean_system
from codeguard.schemas import CLEAN_SCHEMA, CleanChange, CleanOutput
from codeguard.tools import ToolBox, run_checks, run_command
from codeguard.workspace import LocalWorkspace


@dataclass
class CleanRequest:
    target: str
    start: str
    files: list[str]
    goal: str = ""
    run_checks: bool = False
    dry_run: bool = False


@dataclass
class CleanReport:
    target: str
    status: str  # "committed" | "dry_run" | "no_change" | "checks_failed" | "baseline_failed"
    summary: str = ""
    changes: list[CleanChange] = field(default_factory=list)
    left_alone: list[str] = field(default_factory=list)
    out_of_scope: list[str] = field(default_factory=list)
    branch: str | None = None
    commit: str | None = None
    worktree: str | None = None
    diff: str = ""
    checks_output: str = ""
    checks_ran: bool = False
    partial: bool = False
    usage: Usage = field(default_factory=Usage)
    model: str = ""


def scope_files(files: list[str], config: Config) -> list[str]:
    return sorted(
        {
            path.replace("\\", "/")
            for path in files
            if not is_sensitive(path) and not config.is_excluded(path)
        }
    )


def run_clean(
    client,
    root: Path,
    request: CleanRequest,
    config: Config,
    settings: AgentSettings,
    log,
) -> CleanReport:
    if not request.files:
        return CleanReport(target=request.target, status="no_change", summary="Aucun fichier.")

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    # The suffix keeps two cleanups started within the same second from colliding.
    branch = f"codeguard/clean-{stamp}-{secrets.token_hex(3)}"
    temp_dir = Path(tempfile.mkdtemp(prefix="codeguard-"))
    worktree = temp_dir / "worktree"
    gitops.add_worktree(root, worktree, branch, request.start)
    log(f"worktree isolé sur la branche {branch}")

    keep_worktree = False
    keep_branch = False
    report = CleanReport(
        target=request.target, status="no_change", branch=branch, model=settings.model
    )
    try:
        checks = config.checks if request.run_checks else []
        if checks:
            log("vérifications avant nettoyage")
            passed, baseline_output = run_checks(checks, worktree)
            if not passed:
                report.status = "baseline_failed"
                report.checks_output = baseline_output
                report.checks_ran = True
                return report

        workspace = LocalWorkspace(worktree, config, editable=set(request.files))
        result = run_agent(
            client,
            system=clean_system(config.language, config.instructions, bool(checks)),
            prompt=clean_prompt(request.target, request.files, request.goal),
            toolbox=ToolBox(workspace, checks=checks),
            schema=CLEAN_SCHEMA,
            output_model=CleanOutput,
            settings=settings,
            log=log,
        )
        output: CleanOutput = result.output
        report.summary = output.summary
        report.changes = output.changes
        report.left_alone = output.left_alone
        report.usage = result.usage
        report.partial = result.partial
        report.model = settings.model

        if request.run_checks:
            for command in config.formatters:
                log(f"formateur : {command}")
                run_command(command, worktree)

        changed = gitops.changed_files(worktree)
        if not changed:
            return report
        allowed = set(request.files) | workspace.touched
        report.out_of_scope = [path for path in changed if path not in allowed]
        report.diff = gitops.full_diff(worktree)

        if checks:
            log("vérifications après nettoyage")
            passed, check_output = run_checks(checks, worktree)
            report.checks_ran = True
            report.checks_output = check_output
            if not passed:
                report.status = "checks_failed"
                report.worktree = str(worktree)
                keep_worktree = keep_branch = True
                return report

        if request.dry_run:
            report.status = "dry_run"
            return report

        report.commit = gitops.commit_all(worktree, _commit_message(output, request.target))
        report.status = "committed"
        keep_branch = True
        return report
    finally:
        if not keep_worktree:
            gitops.remove_worktree(root, worktree)
            shutil.rmtree(temp_dir, ignore_errors=True)
        if not keep_branch:
            gitops.delete_branch(root, branch)
            report.branch = None


def _commit_message(output: CleanOutput, target: str) -> str:
    lines = [f"chore: nettoyage du code ({target})"[:72], "", output.summary.strip()]
    if output.changes:
        lines.append("")
        lines.extend(f"- {change.path} : {change.description}" for change in output.changes)
    return "\n".join(lines)
