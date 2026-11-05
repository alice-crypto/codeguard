"""Serveur HTTP local de l'interface (bibliothèque standard uniquement).

Toute page web ouverte dans le navigateur peut tenter de joindre un port local. Trois contrôles
s'appliquent donc à chaque requête : l'en-tête Host (contre le DNS rebinding), un cookie de session
issu d'un jeton aléatoire, et un en-tête personnalisé sur les écritures (contre le CSRF).
"""

from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import shutil
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import anthropic

from codeguard import __version__, gitops
from codeguard.clean import run_clean
from codeguard.config import EFFORTS, SEVERITIES, ConfigError, load_config
from codeguard.github import GitHubClient
from codeguard.report import RENDERERS, clean_json, review_json
from codeguard.review import post_review, run_review
from codeguard.service import (
    Overrides,
    describe_error,
    open_cleanup_pull_request,
    prepare_clean,
    prepare_review,
    resolve_repo,
)
from codeguard.ui.jobs import Job, JobBusy, JobManager

DEFAULT_PORT = 8765
MAX_BODY_BYTES = 1_000_000
STATIC_DIR = Path(__file__).parent / "static"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; "
        "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}
_JOB_ACTION = re.compile(r"^/api/jobs/([0-9a-f]+)(?:/(cancel|post|push|discard|export))?$")
_NOT_AUTHENTICATED = (
    "<!doctype html><meta charset=utf-8><title>codeguard</title>"
    "<p>Session requise : ouvre le lien affiché dans le terminal qui a lancé "
    "<code>codeguard ui</code>."
)


class ApiError(Exception):
    def __init__(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


class SessionSecrets:
    """Keys typed in the interface: kept in memory for this process, never written to disk."""

    def __init__(self):
        self.anthropic_key: str | None = None
        self.github_token: str | None = None

    def anthropic_client(self) -> anthropic.Anthropic:
        if self.anthropic_key:
            return anthropic.Anthropic(api_key=self.anthropic_key)
        return anthropic.Anthropic()

    def status(self) -> dict:
        env_anthropic = bool(
            os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        )
        env_github = bool(os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
        return {
            "anthropic": "session" if self.anthropic_key else "env" if env_anthropic else None,
            "github": "session" if self.github_token else "env" if env_github else None,
        }


def _text(body: dict, key: str) -> str | None:
    value = body.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ApiError(f"{key} doit être un texte")
    return value.strip() or None


def _number(body: dict, key: str, kind: type) -> int | float | None:
    value = body.get(key)
    if value is None or value == "":
        return None
    try:
        return kind(value)
    except (TypeError, ValueError):
        raise ApiError(f"{key} doit être un nombre") from None


def _choice(body: dict, key: str, allowed: tuple[str, ...]) -> str | None:
    value = _text(body, key)
    if value is not None and value not in allowed:
        raise ApiError(f"{key} invalide : {value}")
    return value


def _paths(body: dict) -> list[str] | None:
    raw = _text(body, "paths")
    if raw is None:
        return None
    return [line.strip() for line in re.split(r"[\n,]", raw) if line.strip()]


def _open_root(path: str | None) -> Path:
    if not path:
        raise ApiError("aucun projet ouvert")
    folder = Path(path).expanduser()
    if not folder.is_dir():
        raise ApiError(f"dossier introuvable : {path}")
    try:
        return gitops.repo_root(folder)
    except gitops.GitError:
        raise ApiError(f"ce dossier n'est pas un dépôt git : {path}") from None


def _overrides(body: dict) -> Overrides:
    return Overrides(
        effort=_choice(body, "effort", EFFORTS),
        max_cost=_number(body, "max_cost", float),
        min_severity=_choice(body, "min_severity", SEVERITIES),
    )


def project_info(path: str | None) -> dict:
    root = _open_root(path)
    branch = gitops.git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False).strip()
    try:
        base = gitops.default_base(root)
    except gitops.GitError:
        base = None
    status = gitops.git(root, "status", "--porcelain").splitlines()
    info = {
        "root": str(root),
        "name": root.name,
        "branch": branch,
        "default_base": base,
        "changed_files": len(status),
        "github_repo": gitops.github_repo_from_remote(root),
        "config_error": None,
    }
    try:
        config = load_config(root)
    except ConfigError as exc:
        info["config_error"] = str(exc)
        config = None
    if config:
        info["config"] = {
            "model": config.model,
            "effort": config.effort,
            "max_cost_usd": config.max_cost_usd,
            "min_severity": config.min_severity,
            "checks": config.checks,
            "formatters": config.formatters,
        }
    return info


class UiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, token: str | None = None):
        super().__init__(("127.0.0.1", port), _Handler)
        self.token = token or secrets.token_urlsafe(32)
        self.secrets = SessionSecrets()
        self.jobs = JobManager()
        self.bound_port = self.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{self.bound_port}", f"localhost:{self.bound_port}"}
        self.cookie_name = f"codeguard_{self.bound_port}"
        self.launch_url = f"http://127.0.0.1:{self.bound_port}/?token={self.token}"


def create_server(port: int | None = None, token: str | None = None) -> UiServer:
    if port is not None:
        try:
            return UiServer(port, token)
        except OSError as exc:
            raise ConfigError(f"port {port} indisponible : {exc}") from exc
    try:
        return UiServer(DEFAULT_PORT, token)
    except OSError:
        return UiServer(0, token)


class _Handler(BaseHTTPRequestHandler):
    server: UiServer
    server_version = "codeguard"
    sys_version = ""

    def log_message(self, *_args) -> None:
        pass  # the launch URL carries the token: requests are not logged

    # --- Responses

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in {**SECURITY_HEADERS, **(extra or {})}.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, message: str, status: int = HTTPStatus.BAD_REQUEST) -> None:
        self._json({"error": message}, status)

    # --- Access control

    def _host_allowed(self) -> bool:
        return self.headers.get("Host", "") in self.server.allowed_hosts

    def _has_session(self) -> bool:
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == self.server.cookie_name:
                return hmac.compare_digest(value.encode(), self.server.token.encode())
        return False

    def _start_session(self, supplied: str) -> bool:
        if not hmac.compare_digest(supplied.encode(), self.server.token.encode()):
            return False
        cookie = f"{self.server.cookie_name}={self.server.token}; HttpOnly; SameSite=Strict; Path=/"
        # The redirect also removes the token from the address bar and the history.
        self._send(HTTPStatus.SEE_OTHER, b"", "text/plain", {"Location": "/", "Set-Cookie": cookie})
        return True

    def _read_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError("longueur de requête invalide") from None
        if length > MAX_BODY_BYTES:
            raise ApiError("requête trop volumineuse", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError("JSON invalide") from None
        if not isinstance(body, dict):
            raise ApiError("objet JSON attendu")
        return body

    # --- Routing

    def do_GET(self) -> None:
        if not self._host_allowed():
            return self._error("hôte refusé", HTTPStatus.FORBIDDEN)
        url = urlsplit(self.path)
        if url.path == "/" and "token" in (query := parse_qs(url.query)):
            if self._start_session(query["token"][0]):
                return None
            return self._send(
                HTTPStatus.UNAUTHORIZED, _NOT_AUTHENTICATED.encode(), "text/html; charset=utf-8"
            )
        if not self._has_session():
            if url.path.startswith("/api/"):
                return self._error("session requise", HTTPStatus.UNAUTHORIZED)
            return self._send(
                HTTPStatus.UNAUTHORIZED, _NOT_AUTHENTICATED.encode(), "text/html; charset=utf-8"
            )
        if url.path in STATIC_FILES:
            name, content_type = STATIC_FILES[url.path]
            return self._send(HTTPStatus.OK, (STATIC_DIR / name).read_bytes(), content_type)
        self._guarded(lambda: self._route_get(url.path, parse_qs(url.query)))
        return None

    def do_POST(self) -> None:
        if not self._host_allowed():
            return self._error("hôte refusé", HTTPStatus.FORBIDDEN)
        if not self._has_session():
            return self._error("session requise", HTTPStatus.UNAUTHORIZED)
        # A cross-site page cannot set these headers without a preflight, which is never answered.
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip()
        if self.headers.get("X-Codeguard") != "1" or content_type != "application/json":
            return self._error("requête refusée", HTTPStatus.FORBIDDEN)
        self._guarded(lambda: self._route_post(urlsplit(self.path).path, self._read_body()))
        return None

    def _guarded(self, action) -> None:
        try:
            action()
        except ApiError as exc:
            self._error(str(exc), exc.status)
        except JobBusy as exc:
            self._error(str(exc), HTTPStatus.CONFLICT)
        except Exception as exc:
            message = describe_error(exc)
            if message is None:
                traceback.print_exc()
                message = "erreur interne : consulte le terminal de l'interface"
                return self._error(message, HTTPStatus.INTERNAL_SERVER_ERROR)
            self._error(message)
        return None

    def _job(self, job_id: str) -> Job:
        job = self.server.jobs.get(job_id)
        if job is None:
            raise ApiError("analyse introuvable", HTTPStatus.NOT_FOUND)
        return job

    def _route_get(self, path: str, query: dict) -> None:
        if path == "/api/status":
            return self._json(
                {
                    "version": __version__,
                    "credentials": self.server.secrets.status(),
                    "efforts": list(EFFORTS),
                    "severities": list(SEVERITIES),
                }
            )
        if path == "/api/jobs":
            return self._json([self._job_summary(job) for job in self.server.jobs.all()])
        match = _JOB_ACTION.match(path)
        if match and match.group(2) == "export":
            return self._export(self._job(match.group(1)), query)
        if match and match.group(2) is None:
            since = _number({"since": query.get("since", ["0"])[0]}, "since", int) or 0
            return self._json(self._job_detail(self._job(match.group(1)), since))
        return self._error("introuvable", HTTPStatus.NOT_FOUND)

    def _route_post(self, path: str, body: dict) -> None:
        if path == "/api/secrets":
            return self._set_secrets(body)
        if path == "/api/project":
            return self._json(project_info(_text(body, "path")))
        if path == "/api/review":
            return self._start_review(body)
        if path == "/api/clean":
            return self._start_clean(body)
        match = _JOB_ACTION.match(path)
        if match and match.group(2):
            job = self._job(match.group(1))
            action = match.group(2)
            if action == "cancel":
                job.cancel_requested.set()
                return self._json(self._job_summary(job))
            if action == "post":
                return self._post_review(job)
            if action == "push":
                return self._push(job, bool(body.get("open_pr")))
            if action == "discard":
                return self._discard(job)
        return self._error("introuvable", HTTPStatus.NOT_FOUND)

    # --- Actions

    def _set_secrets(self, body: dict) -> None:
        store = self.server.secrets
        if "anthropic_key" in body:
            store.anthropic_key = _text(body, "anthropic_key")
        if "github_token" in body:
            store.github_token = _text(body, "github_token")
        self._json(store.status())

    def _start_review(self, body: dict) -> None:
        mode = _choice(body, "mode", ("auto", "staged", "base", "paths", "pr")) or "auto"
        pr = _number(body, "pr", int) if mode == "pr" else None
        if mode == "pr" and pr is None:
            raise ApiError("indique le numéro de la pull request")
        base = _text(body, "base") if mode == "base" else None
        if mode == "base" and not base:
            raise ApiError("indique la référence de base")
        paths = _paths(body) if mode == "paths" else None
        if mode == "paths" and not paths:
            raise ApiError("indique au moins un fichier ou un dossier")
        project = _text(body, "path")
        root = _open_root(project) if project or mode != "pr" else None
        repo = _text(body, "repo")
        overrides = _overrides(body)
        secrets_store = self.server.secrets

        def work(job: Job, log):
            log("préparation de la cible")
            prepared = prepare_review(
                root,
                staged=mode == "staged",
                base=base,
                paths=paths,
                pr=pr,
                repo=repo,
                overrides=overrides,
                github_token=secrets_store.github_token,
                cwd=root,
            )
            job.prepared = prepared
            log(f"cible : {prepared.target.description}")
            return run_review(
                secrets_store.anthropic_client(),
                prepared.target,
                prepared.config,
                prepared.settings,
                log,
            )

        label = {
            "auto": "changements en cours",
            "staged": "changements indexés",
            "base": f"depuis {base}",
            "paths": ", ".join(paths or []),
            "pr": f"PR #{pr}",
        }[mode]
        job = self.server.jobs.start("review", label, work, root)
        self._json(self._job_summary(job), HTTPStatus.ACCEPTED)

    def _start_clean(self, body: dict) -> None:
        mode = _choice(body, "mode", ("base", "paths", "pr")) or "base"
        root = _open_root(_text(body, "path"))
        pr = _number(body, "pr", int) if mode == "pr" else None
        if mode == "pr" and pr is None:
            raise ApiError("indique le numéro de la pull request")
        base = _text(body, "base") if mode == "base" else None
        paths = _paths(body) if mode == "paths" else None
        if mode == "paths" and not paths:
            raise ApiError("indique au moins un fichier ou un dossier")
        repo = _text(body, "repo")
        goal = _text(body, "goal") or ""
        run_checks = bool(body.get("run_checks"))
        dry_run = bool(body.get("dry_run"))
        overrides = _overrides(body)
        secrets_store = self.server.secrets

        def work(job: Job, log):
            log("préparation du périmètre")
            prepared = prepare_clean(
                root,
                base=base,
                paths=paths,
                pr=pr,
                repo=repo,
                goal=goal,
                run_checks=run_checks,
                dry_run=dry_run,
                overrides=overrides,
                github_token=secrets_store.github_token,
                cwd=root,
            )
            job.prepared = prepared
            for warning in prepared.warnings:
                log(f"attention : {warning}")
            log(f"{len(prepared.request.files)} fichier(s) dans le périmètre")
            return run_clean(
                secrets_store.anthropic_client(),
                root,
                prepared.request,
                prepared.config,
                prepared.settings,
                log,
            )

        label = {"base": f"depuis {base or 'la base'}", "paths": ", ".join(paths or [])}.get(
            mode, f"PR #{pr}"
        )
        job = self.server.jobs.start("clean", label, work, root)
        self._json(self._job_summary(job), HTTPStatus.ACCEPTED)

    def _finished_report(self, job: Job, kind: str):
        if job.kind != kind or job.status != "done" or job.report is None:
            raise ApiError("cette analyse n'est pas terminée", HTTPStatus.CONFLICT)
        return job.report

    def _post_review(self, job: Job) -> None:
        report = self._finished_report(job, "review")
        prepared = job.prepared
        if prepared.target.pull_request is None:
            raise ApiError("seule une review de pull request peut être publiée")
        if report.posted_url:
            raise ApiError("cette review est déjà publiée", HTTPStatus.CONFLICT)
        report.posted_url = post_review(prepared.github, prepared.repo, report, prepared.target)
        self._json(self._job_detail(job, len(job.logs)))

    def _push(self, job: Job, open_pr: bool) -> None:
        report = self._finished_report(job, "clean")
        if report.status != "committed" or job.discarded:
            raise ApiError("aucune branche à pousser")
        prepared = job.prepared
        # Checked first, so that a missing token does not leave the branch half delivered.
        github = prepared.github
        repo = prepared.repo
        if open_pr and github is None:
            github = GitHubClient(token=self.server.secrets.github_token)
            repo = resolve_repo(None, job.root)
        if not job.pushed:
            gitops.push_branch(job.root, report.branch)
            job.pushed = True
        if open_pr and not job.pull_request_url:
            job.pull_request_url = open_cleanup_pull_request(
                github, repo, job.root, report, prepared.pull_request
            )
        self._json(self._job_detail(job, len(job.logs)))

    def _discard(self, job: Job) -> None:
        report = self._finished_report(job, "clean")
        if not report.branch or not report.branch.startswith("codeguard/clean-"):
            raise ApiError("aucune branche à supprimer")
        if job.pushed:
            raise ApiError("cette branche est déjà poussée : supprime-la aussi sur GitHub")
        if report.worktree:
            worktree = Path(report.worktree)
            gitops.remove_worktree(job.root, worktree)
            shutil.rmtree(worktree.parent, ignore_errors=True)
        gitops.delete_branch(job.root, report.branch)
        job.discarded = True
        self._json(self._job_detail(job, len(job.logs)))

    def _export(self, job: Job, query: dict) -> None:
        report = self._finished_report(job, "review")
        fmt = query.get("format", ["markdown"])[0]
        if fmt not in RENDERERS:
            raise ApiError(f"format inconnu : {fmt}")
        extension = {"markdown": "md", "text": "txt", "json": "json", "sarif": "sarif"}[fmt]
        self._send(
            HTTPStatus.OK,
            RENDERERS[fmt](report).encode("utf-8"),
            "application/octet-stream",
            {"Content-Disposition": f'attachment; filename="codeguard-review.{extension}"'},
        )

    # --- Serialization

    def _job_summary(self, job: Job) -> dict:
        return {
            "id": job.id,
            "kind": job.kind,
            "label": job.label,
            "status": job.status,
            "created": job.created,
            "finished": job.finished,
            "cancel_requested": job.cancel_requested.is_set(),
        }

    def _job_detail(self, job: Job, since: int) -> dict:
        logs = job.logs[max(since, 0) :]
        detail = {
            **self._job_summary(job),
            "error": job.error,
            "logs": logs,
            "log_count": max(since, 0) + len(logs),
            "result": None,
        }
        if job.status != "done" or job.report is None:
            return detail
        if job.kind == "review":
            pull_request = job.prepared.target.pull_request if job.prepared else None
            detail["result"] = json.loads(review_json(job.report))
            detail["can_post"] = pull_request is not None
            detail["repo"] = job.prepared.repo if job.prepared else None
        else:
            detail["result"] = clean_json(job.report)
            detail["pushed"] = job.pushed
            detail["pull_request_url"] = job.pull_request_url
            detail["discarded"] = job.discarded
            detail["github_repo"] = gitops.github_repo_from_remote(job.root)
        return detail
