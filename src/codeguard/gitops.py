"""Opérations git locales."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

_REMOTE = re.compile(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$")


class GitError(Exception):
    pass


def git(root: Path, *args: str, check: bool = True, input_text: str | None = None) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            ["git", "-c", "core.quotepath=off", *args],
            cwd=root,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            input=input_text,
            env=env,
        )
    except FileNotFoundError as exc:
        raise GitError("git est introuvable dans le PATH") from exc
    if check and result.returncode != 0:
        raise GitError(f"git {args[0]} a échoué : {result.stderr.strip()}")
    return result.stdout


def repo_root(path: Path) -> Path:
    return Path(git(path, "rev-parse", "--show-toplevel").strip())


def _safe_ref(ref: str) -> str:
    if not ref or ref.startswith("-"):
        raise GitError(f"référence git invalide : {ref!r}")
    return ref


def verify_ref(root: Path, ref: str) -> str:
    return git(root, "rev-parse", "--verify", f"{_safe_ref(ref)}^{{commit}}").strip()


def default_base(root: Path) -> str:
    head = git(root, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD", check=False).strip()
    if head:
        return head.removeprefix("refs/remotes/")
    for candidate in ("origin/main", "origin/master", "main", "master"):
        if git(root, "rev-parse", "--verify", "--quiet", candidate, check=False).strip():
            return candidate
    raise GitError("branche de base introuvable : précise-la avec --base")


def head_sha(root: Path) -> str:
    return git(root, "rev-parse", "HEAD").strip()


def diff_staged(root: Path) -> str:
    return git(root, "diff", "--cached", "--no-color", "--no-ext-diff")


def diff_base(root: Path, base: str) -> str:
    return git(root, "diff", "--no-color", "--no-ext-diff", f"{_safe_ref(base)}...HEAD")


def untracked_files(root: Path) -> list[str]:
    output = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    return [name for name in output.split("\0") if name]


def diff_uncommitted(root: Path) -> str:
    """Tracked changes against HEAD, plus untracked files shown as additions."""
    parts = [git(root, "diff", "HEAD", "--no-color", "--no-ext-diff")]
    for name in untracked_files(root):
        # --no-index exits with status 1 when files differ, which is the normal case here.
        parts.append(
            git(root, "diff", "--no-color", "--no-index", "--", os.devnull, name, check=False)
        )
    return "".join(parts)


def has_uncommitted(root: Path) -> bool:
    return bool(git(root, "status", "--porcelain").strip())


def tracked_and_untracked(root: Path) -> list[str]:
    output = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    return sorted({name for name in output.split("\0") if name})


def github_repo_from_remote(root: Path, remote: str = "origin") -> str | None:
    url = git(root, "remote", "get-url", remote, check=False).strip()
    match = _REMOTE.search(url)
    return f"{match.group(1)}/{match.group(2)}" if match else None


def add_worktree(root: Path, path: Path, branch: str, start: str) -> None:
    git(root, "worktree", "add", "--quiet", "-b", branch, str(path), _safe_ref(start))


def remove_worktree(root: Path, path: Path) -> None:
    git(root, "worktree", "remove", "--force", str(path), check=False)
    git(root, "worktree", "prune", check=False)


def delete_branch(root: Path, branch: str) -> None:
    git(root, "branch", "-D", branch, check=False)


def changed_files(worktree: Path) -> list[str]:
    tracked = git(worktree, "diff", "HEAD", "--name-only", "-z", "--no-renames")
    names = {name for name in tracked.split("\0") if name}
    names.update(untracked_files(worktree))
    return sorted(names)


def full_diff(worktree: Path) -> str:
    """Every pending change, including new files, without leaving them staged."""
    git(worktree, "add", "-A", "--intent-to-add")
    return git(worktree, "diff", "HEAD", "--no-color", "--no-ext-diff")


def commit_all(worktree: Path, message: str) -> str:
    git(worktree, "add", "-A")
    git(worktree, "commit", "--quiet", "-m", message)
    return head_sha(worktree)


def push_branch(root: Path, branch: str, remote: str = "origin") -> None:
    git(root, "push", "--quiet", "--set-upstream", remote, f"{branch}:{branch}")


def fetch_pull_request(root: Path, number: int, remote: str = "origin") -> str:
    git(root, "fetch", "--quiet", remote, f"refs/pull/{number}/head")
    return git(root, "rev-parse", "FETCH_HEAD").strip()
