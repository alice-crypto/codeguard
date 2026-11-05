"""Client minimal de l'API REST GitHub (bibliothèque standard uniquement)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


class GitHubError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    """urllib replays every header on redirect: never carry the token to another host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            old_host = urllib.parse.urlsplit(req.full_url).netloc
            if urllib.parse.urlsplit(newurl).netloc != old_host:
                new.remove_header("Authorization")
        return new


def token_from_env() -> str | None:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def _check_api_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    local = parts.hostname in ("localhost", "127.0.0.1", "::1")
    if parts.scheme != "https" and not (parts.scheme == "http" and local):
        raise GitHubError(f"URL d'API refusée (HTTPS requis pour le token) : {url}")
    return url.rstrip("/")


@dataclass
class PullRequest:
    number: int
    title: str
    body: str
    head_sha: str
    base_sha: str
    head_ref: str
    base_ref: str
    head_repo: str
    url: str


class GitHubClient:
    def __init__(self, token: str | None = None, api_url: str | None = None):
        self.token = token if token is not None else token_from_env()
        self.api_url = _check_api_url(
            api_url or os.environ.get("GITHUB_API_URL") or "https://api.github.com"
        )
        self._opener = urllib.request.build_opener(_SameHostRedirect())

    def _request(
        self,
        method: str,
        path: str,
        *,
        accept: str = "application/vnd.github+json",
        payload: dict | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        url = path if path.startswith("http") else f"{self.api_url}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Accept", accept)
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("User-Agent", "codeguard")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        try:
            with self._opener.open(request, timeout=60) as response:
                return response.read(), dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise GitHubError(self._explain(exc.code, path, detail), exc.code) from exc
        except urllib.error.URLError as exc:
            raise GitHubError(f"GitHub injoignable : {exc.reason}") from exc

    def _explain(self, status: int, path: str, detail: str) -> str:
        hint = ""
        if status in (401, 403) and not self.token:
            hint = " Définis GITHUB_TOKEN ou GH_TOKEN."
        elif status == 403:
            hint = " Vérifie les droits du token (et la limite de requêtes)."
        return f"GitHub {status} sur {path} : {detail}{hint}"

    def _json(self, method: str, path: str, payload: dict | None = None):
        body, _ = self._request(method, path, payload=payload)
        return json.loads(body) if body else None

    def _paginate(self, path: str) -> list:
        items: list = []
        separator = "&" if "?" in path else "?"
        next_url: str | None = f"{path}{separator}per_page=100"
        while next_url:
            body, headers = self._request("GET", next_url)
            items.extend(json.loads(body))
            next_url = None
            for part in headers.get("Link", headers.get("link", "")).split(","):
                if 'rel="next"' in part:
                    next_url = part[part.index("<") + 1 : part.index(">")]
        return items

    def get_pull_request(self, repo: str, number: int) -> PullRequest:
        data = self._json("GET", f"/repos/{repo}/pulls/{number}")
        head_repo = (data["head"].get("repo") or {}).get("full_name", "")
        return PullRequest(
            number=number,
            title=data.get("title") or "",
            body=data.get("body") or "",
            head_sha=data["head"]["sha"],
            base_sha=data["base"]["sha"],
            head_ref=data["head"]["ref"],
            base_ref=data["base"]["ref"],
            head_repo=head_repo,
            url=data.get("html_url", ""),
        )

    def get_pull_request_diff(self, repo: str, number: int) -> str:
        body, _ = self._request(
            "GET", f"/repos/{repo}/pulls/{number}", accept="application/vnd.github.v3.diff"
        )
        return body.decode("utf-8", errors="replace")

    def list_tree(self, repo: str, ref: str) -> list[str]:
        data = self._json("GET", f"/repos/{repo}/git/trees/{ref}?recursive=1")
        if data.get("truncated"):
            raise GitHubError(f"arbre de {repo} trop volumineux pour l'API GitHub")
        return [item["path"] for item in data["tree"] if item["type"] == "blob"]

    def get_file(self, repo: str, path: str, ref: str) -> bytes:
        quoted = urllib.parse.quote(path)
        body, _ = self._request(
            "GET",
            f"/repos/{repo}/contents/{quoted}?ref={urllib.parse.quote(ref)}",
            accept="application/vnd.github.raw+json",
        )
        return body

    def list_review_comment_bodies(self, repo: str, number: int) -> list[str]:
        comments = self._paginate(f"/repos/{repo}/pulls/{number}/comments")
        return [comment.get("body", "") for comment in comments]

    def create_review(
        self, repo: str, number: int, commit_id: str, body: str, comments: list[dict]
    ) -> str:
        # Always a plain comment: approving or blocking a PR stays a human decision.
        data = self._json(
            "POST",
            f"/repos/{repo}/pulls/{number}/reviews",
            {"commit_id": commit_id, "body": body, "event": "COMMENT", "comments": comments},
        )
        return data.get("html_url", "")

    def create_pull_request(self, repo: str, title: str, head: str, base: str, body: str) -> str:
        data = self._json(
            "POST",
            f"/repos/{repo}/pulls",
            {"title": title, "head": head, "base": base, "body": body},
        )
        return data.get("html_url", "")
