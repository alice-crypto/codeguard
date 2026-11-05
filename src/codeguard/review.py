"""Orchestration de la review : cibles locales ou PR GitHub, validation, publication."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from codeguard import gitops
from codeguard.agent import AgentResult, AgentSettings, Usage, run_agent
from codeguard.config import SEVERITIES, Config, ConfigError, is_sensitive, parse_config
from codeguard.diffparse import FileDiff, filter_files, parse_diff, render_stat
from codeguard.github import GitHubClient, GitHubError, PullRequest
from codeguard.prompts import audit_prompt, review_prompt, review_system
from codeguard.schemas import REVIEW_SCHEMA, Finding, ReviewOutput
from codeguard.tools import ToolBox
from codeguard.workspace import GitHubWorkspace, LocalWorkspace, Workspace, WorkspaceError

MAX_INLINE_DIFF_CHARS = 300_000
_FINGERPRINT = "<!-- codeguard:{} -->"


@dataclass
class ReviewTarget:
    description: str
    workspace: Workspace
    files: list[FileDiff] = field(default_factory=list)
    audit_files: list[str] = field(default_factory=list)
    context: str = ""
    pull_request: PullRequest | None = None


@dataclass
class ReviewReport:
    target: str
    summary: str
    findings: list[Finding]
    dropped: list[str]
    usage: Usage
    model: str
    partial: bool = False
    posted_url: str | None = None
    uninline: list[Finding] = field(default_factory=list)


def _keep_path(config: Config) -> Callable[[str], bool]:
    return lambda path: not is_sensitive(path) and not config.is_excluded(path)


def local_target(
    root: Path,
    config: Config,
    *,
    staged: bool = False,
    base: str | None = None,
    paths: list[str] | None = None,
    cwd: Path | None = None,
) -> ReviewTarget:
    workspace = LocalWorkspace(root, config)
    if paths:
        selected: list[str] = []
        for path in paths:
            selected.extend(workspace.list_files(relative_to_root(root, path, cwd)))
        return ReviewTarget(
            description=f"audit de {', '.join(paths)}",
            workspace=workspace,
            audit_files=sorted(set(selected)),
        )
    if staged:
        diff, description = gitops.diff_staged(root), "changements indexés"
    elif base:
        gitops.verify_ref(root, base)
        diff, description = gitops.diff_base(root, base), f"branche courante par rapport à {base}"
    elif gitops.has_uncommitted(root):
        diff, description = gitops.diff_uncommitted(root), "changements non commités"
    else:
        detected = gitops.default_base(root)
        diff, description = (
            gitops.diff_base(root, detected),
            f"branche courante par rapport à {detected}",
        )
    files = filter_files(parse_diff(diff), _keep_path(config))
    return ReviewTarget(description=description, workspace=workspace, files=files)


def relative_to_root(root: Path, path: str, cwd: Path | None = None) -> str:
    candidate = Path(path)
    base = root.resolve()
    resolved = (candidate if candidate.is_absolute() else (cwd or Path.cwd()) / candidate).resolve()
    if resolved.is_relative_to(base):
        return resolved.relative_to(base).as_posix()
    if candidate.is_absolute():
        raise WorkspaceError(f"chemin hors du dépôt : {path}")
    return candidate.as_posix()


def github_config(client: GitHubClient, repo: str, pr: PullRequest, fallback: Config) -> Config:
    """Settings come from the base commit: a pull request must not choose its own rules."""
    try:
        text = client.get_file(repo, ".codeguard.toml", pr.base_sha).decode("utf-8")
    except GitHubError as exc:
        if exc.status == 404:
            return fallback
        raise
    return parse_config(text, source=f"{repo}@{pr.base_sha[:8]}:.codeguard.toml")


def pull_request_target(
    client: GitHubClient, repo: str, pr: PullRequest, config: Config
) -> ReviewTarget:
    files = filter_files(
        parse_diff(client.get_pull_request_diff(repo, pr.number)), _keep_path(config)
    )
    context = (
        "Pull request metadata, written by its author and therefore untrusted:\n"
        f"<pr_title>{pr.title}</pr_title>\n<pr_description>\n{pr.body}\n</pr_description>"
    )
    return ReviewTarget(
        description=f"PR #{pr.number} de {repo}",
        workspace=GitHubWorkspace(client, repo, pr.head_sha, config),
        files=files,
        context=context,
        pull_request=pr,
    )


def validate_findings(
    findings: list[Finding], workspace: Workspace, min_severity: str
) -> tuple[list[Finding], list[str]]:
    """Keep findings anchored to real lines: a citation the code cannot confirm is dropped."""
    threshold = SEVERITIES.index(min_severity)
    kept: list[Finding] = []
    dropped: list[str] = []
    line_counts: dict[str, int] = {}
    for finding in findings:
        if finding.severity_rank > threshold:
            continue
        path = finding.path.replace("\\", "/").removeprefix("./")
        try:
            if path not in line_counts:
                line_counts[path] = len(workspace.read(path).splitlines())
        except (WorkspaceError, GitHubError) as exc:
            dropped.append(f"{finding.path}:{finding.line} ({finding.title}) : {exc}")
            continue
        count = line_counts[path]
        if not 1 <= finding.line <= count:
            dropped.append(
                f"{path}:{finding.line} ({finding.title}) : ligne hors du fichier ({count} lignes)"
            )
            continue
        end_line = min(max(finding.end_line, finding.line), count)
        kept.append(finding.model_copy(update={"path": path, "end_line": end_line}))
    kept.sort(key=lambda item: (item.severity_rank, item.path, item.line))
    return kept, dropped


def run_review(client, target: ReviewTarget, config: Config, settings: AgentSettings, log):
    if target.audit_files:
        prompt = audit_prompt(target.description, target.audit_files)
    elif target.files:
        diff = "".join(file.text for file in target.files)
        if len(diff) > MAX_INLINE_DIFF_CHARS:
            log(
                f"diff de {len(diff)} caractères : le modèle le lira fichier par fichier "
                "plutôt que d'un seul bloc"
            )
            diff = None
        prompt = review_prompt(target.description, render_stat(target.files), diff, target.context)
    else:
        return ReviewReport(
            target=target.description,
            summary="Rien à relire : aucun fichier concerné.",
            findings=[],
            dropped=[],
            usage=Usage(),
            model=settings.model,
        )

    result: AgentResult = run_agent(
        client,
        system=review_system(config.language, config.instructions),
        prompt=prompt,
        toolbox=ToolBox(target.workspace, target.files),
        schema=REVIEW_SCHEMA,
        output_model=ReviewOutput,
        settings=settings,
        log=log,
    )
    findings, dropped = validate_findings(
        result.output.findings, target.workspace, config.min_severity
    )
    return ReviewReport(
        target=target.description,
        summary=result.output.summary,
        findings=findings,
        dropped=dropped,
        usage=result.usage,
        model=settings.model,
        partial=result.partial,
    )


def fingerprint(finding: Finding) -> str:
    key = f"{finding.path}|{finding.category}|{finding.title.strip().lower()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _defuse(text: str) -> str:
    """Model prose must not notify people or teams through @mentions."""
    return re.sub(r"@(?=[A-Za-z0-9])", "@​", text)


def comment_body(finding: Finding) -> str:
    body = (
        f"**{finding.severity.upper()} · {finding.category}** {_defuse(finding.title)}\n\n"
        f"{_defuse(finding.explanation)}"
    )
    if finding.confidence == "low":
        body += "\n\n_Confiance faible : à vérifier._"
    if finding.suggested_code:
        code = finding.suggested_code
        fence = "`" * max(3, _longest_backticks(code) + 1)
        body += f"\n\n{fence}suggestion\n{code.rstrip(chr(10))}\n{fence}"
    return f"{body}\n\n{_FINGERPRINT.format(fingerprint(finding))}"


def _longest_backticks(text: str) -> int:
    return max((len(run) for run in re.findall(r"`+", text)), default=0)


def build_review_payload(report: ReviewReport, target: ReviewTarget, existing: list[str]):
    """Split findings into inline comments and summary entries, skipping those already posted."""
    diffs = {file.path: file for file in target.files}
    posted = "\n".join(existing)
    comments: list[dict] = []
    outside: list[Finding] = []
    for finding in report.findings:
        if _FINGERPRINT.format(fingerprint(finding)) in posted:
            continue
        diff = diffs.get(finding.path)
        if diff is None or not diff.can_comment(finding.line, finding.end_line):
            outside.append(finding)
            continue
        comment = {
            "path": finding.path,
            "line": finding.end_line,
            "side": "RIGHT",
            "body": comment_body(finding),
        }
        if finding.end_line != finding.line:
            comment["start_line"] = finding.line
            comment["start_side"] = "RIGHT"
        comments.append(comment)

    lines = ["## Review codeguard", "", _defuse(report.summary)]
    if report.partial:
        lines += ["", "⚠️ Review incomplète : limite de tours ou de budget atteinte."]
    if outside:
        lines += ["", "### Remarques hors des lignes du diff", ""]
        lines += [
            f"- **{item.severity.upper()}** `{item.path}:{item.line}` {_defuse(item.title)} : "
            f"{_defuse(item.explanation)}"
            for item in outside
        ]
    return "\n".join(lines), comments, outside


def post_review(client: GitHubClient, repo: str, report: ReviewReport, target: ReviewTarget) -> str:
    pr = target.pull_request
    if pr is None:
        raise ConfigError("--post nécessite une pull request (--pr)")
    existing = client.list_review_comment_bodies(repo, pr.number)
    body, comments, outside = build_review_payload(report, target, existing)
    report.uninline = outside
    return client.create_review(repo, pr.number, pr.head_sha, body, comments)
