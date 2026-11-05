"""Préparation des analyses, partagée par la CLI et l'interface graphique."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import anthropic

from codeguard import gitops
from codeguard.agent import AgentError, AgentSettings
from codeguard.clean import CleanReport, CleanRequest, scope_files
from codeguard.config import Config, ConfigError, load_config
from codeguard.diffparse import parse_diff
from codeguard.github import GitHubClient, GitHubError, PullRequest
from codeguard.report import clean_text
from codeguard.review import (
    ReviewTarget,
    github_config,
    local_target,
    pull_request_target,
    relative_to_root,
)
from codeguard.workspace import LocalWorkspace, WorkspaceError


@dataclass
class Overrides:
    model: str | None = None
    effort: str | None = None
    max_turns: int | None = None
    max_cost: float | None = None
    min_severity: str | None = None

    def apply(self, config: Config) -> AgentSettings:
        config.model = self.model or config.model
        config.effort = self.effort or config.effort
        if self.max_turns is not None:
            config.max_turns = self.max_turns
        if self.max_cost is not None:
            config.max_cost_usd = self.max_cost
        if self.min_severity:
            config.min_severity = self.min_severity
        config.validate()
        return AgentSettings(config.model, config.effort, config.max_turns, config.max_cost_usd)


@dataclass
class PreparedReview:
    config: Config
    settings: AgentSettings
    target: ReviewTarget
    github: GitHubClient | None = None
    repo: str | None = None


@dataclass
class PreparedClean:
    config: Config
    settings: AgentSettings
    request: CleanRequest
    github: GitHubClient | None = None
    repo: str | None = None
    pull_request: PullRequest | None = None
    warnings: list[str] = field(default_factory=list)


def resolve_repo(repo: str | None, root: Path | None) -> str:
    resolved = repo or os.environ.get("GITHUB_REPOSITORY")
    if not resolved and root:
        resolved = gitops.github_repo_from_remote(root)
    if not resolved:
        raise ConfigError("dépôt GitHub introuvable : précise-le au format owner/nom")
    return resolved


def prepare_review(
    root: Path | None,
    *,
    staged: bool = False,
    base: str | None = None,
    paths: list[str] | None = None,
    pr: int | None = None,
    repo: str | None = None,
    config_path: Path | None = None,
    overrides: Overrides | None = None,
    github_token: str | None = None,
    cwd: Path | None = None,
) -> PreparedReview:
    overrides = overrides or Overrides()
    if pr is not None:
        resolved = resolve_repo(repo, root)
        github = GitHubClient(token=github_token)
        pull_request = github.get_pull_request(resolved, pr)
        # The local file is trusted only as a fallback for a base commit that has none.
        fallback = load_config(root or Path.cwd(), config_path)
        config = github_config(github, resolved, pull_request, fallback)
        if config_path:
            config = fallback
        settings = overrides.apply(config)
        target = pull_request_target(github, resolved, pull_request, config)
        return PreparedReview(config, settings, target, github, resolved)

    if root is None:
        raise ConfigError("pas de dépôt git ici : ouvre un dépôt ou vise une pull request")
    config = load_config(root, config_path)
    settings = overrides.apply(config)
    target = local_target(root, config, staged=staged, base=base, paths=paths, cwd=cwd)
    return PreparedReview(config, settings, target)


def prepare_clean(
    root: Path,
    *,
    base: str | None = None,
    paths: list[str] | None = None,
    pr: int | None = None,
    repo: str | None = None,
    goal: str = "",
    run_checks: bool = False,
    dry_run: bool = False,
    need_github: bool = False,
    config_path: Path | None = None,
    overrides: Overrides | None = None,
    github_token: str | None = None,
    cwd: Path | None = None,
) -> PreparedClean:
    # Always the local checkout's config: on a PR, these commands must not come from its code.
    config = load_config(root, config_path)
    settings = (overrides or Overrides()).apply(config)
    start = "HEAD"
    pull_request = None
    github = None
    resolved = None
    if pr is not None or need_github:
        resolved = resolve_repo(repo, root)
        github = GitHubClient(token=github_token)

    if pr is not None:
        pull_request = github.get_pull_request(resolved, pr)
        start = gitops.fetch_pull_request(root, pr)
        files = [
            file.path
            for file in parse_diff(github.get_pull_request_diff(resolved, pr))
            if not file.deleted
        ]
        target = f"PR #{pr}"
    elif paths:
        workspace = LocalWorkspace(root, config)
        files = []
        for path in paths:
            files.extend(workspace.list_files(relative_to_root(root, path, cwd)))
        target = ", ".join(paths)
    else:
        base = base or gitops.default_base(root)
        gitops.verify_ref(root, base)
        files = [file.path for file in parse_diff(gitops.diff_base(root, base)) if not file.deleted]
        target = f"fichiers modifiés depuis {base}"

    warnings = []
    if gitops.has_uncommitted(root):
        warnings.append("les changements non commités ne font pas partie du nettoyage")
    if not run_checks and config.checks:
        warnings.append("checks configurés mais non lancés")
    if run_checks and not config.checks:
        warnings.append("vérifications demandées, mais aucun check n'est configuré")

    request = CleanRequest(
        target=target,
        start=start,
        files=scope_files(files, config),
        goal=goal,
        run_checks=run_checks,
        dry_run=dry_run,
    )
    return PreparedClean(config, settings, request, github, resolved, pull_request, warnings)


def open_cleanup_pull_request(
    github: GitHubClient,
    repo: str,
    root: Path,
    report: CleanReport,
    pull_request: PullRequest | None,
) -> str:
    if pull_request is not None and pull_request.head_repo != repo:
        raise ConfigError(
            "cette PR vient d'un fork : la branche est poussée, ouvre la PR de nettoyage à la main"
        )
    if pull_request is not None:
        base = pull_request.head_ref
    else:
        branch = gitops.git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
        base = branch if branch != "HEAD" else gitops.default_base(root).removeprefix("origin/")
    title = f"Nettoyage du code : {report.target}"[:120]
    return github.create_pull_request(repo, title, report.branch, base, clean_text(report))


def describe_error(exc: Exception) -> str | None:
    """User-facing message for an expected failure, None for a genuine bug."""
    if isinstance(exc, ConfigError | AgentError | GitHubError | WorkspaceError | gitops.GitError):
        return str(exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return "clé API Anthropic refusée."
    if isinstance(exc, anthropic.RateLimitError):
        return "limite de requêtes Anthropic atteinte."
    if isinstance(exc, anthropic.APIStatusError):
        return f"erreur de l'API Anthropic ({exc.status_code}) : {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "API Anthropic injoignable."
    # Raised by the SDK when no credential source can be resolved.
    if isinstance(exc, TypeError) and (
        "authentication" in str(exc).lower() or "api_key" in str(exc).lower()
    ):
        return "aucune clé API Anthropic : définis ANTHROPIC_API_KEY."
    return None
