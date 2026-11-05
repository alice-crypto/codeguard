"""Accès aux fichiers du dépôt : local (lecture/écriture) ou GitHub (lecture seule).

C'est ici que sont appliquées les limites de l'agent : confinement à la racine,
fichiers sensibles invisibles et périmètre d'édition.
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from codeguard import gitops
from codeguard.config import Config, is_sensitive
from codeguard.github import GitHubClient, GitHubError

MAX_FILE_BYTES = 2_000_000
MAX_SEARCH_RESULTS = 100
MAX_LOCAL_SEARCH_FILES = 5_000
MAX_REMOTE_SEARCH_FILES = 300


class WorkspaceError(Exception):
    pass


def normalize_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip()
    pure = PurePosixPath(normalized)
    if not normalized or pure.is_absolute() or re.match(r"^[A-Za-z]:", normalized):
        raise WorkspaceError(f"chemin refusé (doit être relatif à la racine) : {path}")
    if ".." in pure.parts or ".git" in pure.parts:
        raise WorkspaceError(f"chemin refusé : {path}")
    if is_sensitive(normalized):
        raise WorkspaceError(f"fichier sensible, accès refusé : {path}")
    return pure.as_posix()


class Workspace:
    """Read side shared by both implementations."""

    max_search_files = MAX_LOCAL_SEARCH_FILES

    def __init__(self, config: Config):
        self.config = config

    def _all_files(self) -> list[str]:
        raise NotImplementedError

    def read(self, path: str) -> str:
        raise NotImplementedError

    def list_files(self, prefix: str = "") -> list[str]:
        prefix = prefix.replace("\\", "/").strip("/")
        return [
            name
            for name in self._all_files()
            if not is_sensitive(name)
            and not self.config.is_excluded(name)
            and (not prefix or name == prefix or name.startswith(prefix + "/"))
        ]

    def search(self, pattern: str, prefix: str = "") -> tuple[list[str], str | None]:
        """Return "path:line: text" matches and a note when the search was cut short."""
        regex = re.compile(pattern)
        files = self.list_files(prefix)
        note = None
        if len(files) > self.max_search_files:
            note = (
                f"Recherche limitée aux {self.max_search_files} premiers fichiers sur "
                f"{len(files)} : affine avec `path`."
            )
            files = files[: self.max_search_files]
        matches: list[str] = []
        for name in files:
            try:
                content = self.read(name)
            except (WorkspaceError, GitHubError):
                continue
            for number, line in enumerate(content.splitlines(), start=1):
                if regex.search(line):
                    matches.append(f"{name}:{number}: {line.strip()[:300]}")
                    if len(matches) >= MAX_SEARCH_RESULTS:
                        return matches, f"Limite de {MAX_SEARCH_RESULTS} résultats atteinte."
        return matches, note


def _decode(path: str, data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise WorkspaceError(f"fichier trop volumineux ({len(data)} octets) : {path}")
    if b"\0" in data[:8192]:
        raise WorkspaceError(f"fichier binaire : {path}")
    return data.decode("utf-8", errors="replace")


class LocalWorkspace(Workspace):
    def __init__(self, root: Path, config: Config, editable: set[str] | None = None):
        super().__init__(config)
        self.root = root.resolve()
        self.editable = editable
        self.touched: set[str] = set()
        self.created: set[str] = set()

    def _all_files(self) -> list[str]:
        return gitops.tracked_and_untracked(self.root)

    def _resolve(self, path: str) -> tuple[str, Path]:
        normalized = normalize_path(path)
        resolved = (self.root / normalized).resolve()
        # resolve() follows symlinks, so a link pointing outside the root is caught too.
        if not resolved.is_relative_to(self.root):
            raise WorkspaceError(f"chemin hors du dépôt : {path}")
        return normalized, resolved

    def read(self, path: str) -> str:
        normalized, resolved = self._resolve(path)
        if not resolved.is_file():
            raise WorkspaceError(f"fichier introuvable : {normalized}")
        return _decode(normalized, resolved.read_bytes())

    def _check_editable(self, normalized: str) -> None:
        if self.editable is None:
            raise WorkspaceError("ce mode est en lecture seule")
        if normalized not in self.editable and normalized not in self.created:
            raise WorkspaceError(
                f"hors du périmètre de nettoyage : {normalized}. "
                "Signale-le dans ta réponse finale au lieu de le modifier."
            )

    def edit(self, path: str, old: str, new: str) -> None:
        normalized, resolved = self._resolve(path)
        self._check_editable(normalized)
        if not resolved.is_file():
            raise WorkspaceError(f"fichier introuvable : {normalized}")
        try:
            content = resolved.read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise WorkspaceError(f"fichier non UTF-8, édition refusée : {normalized}") from exc
        if not old:
            raise WorkspaceError("old_text ne doit pas être vide")
        # The model sees and writes LF; keep the file's own line endings on disk.
        if "\r\n" in content:
            old = old.replace("\r\n", "\n").replace("\n", "\r\n")
            new = new.replace("\r\n", "\n").replace("\n", "\r\n")
        count = content.count(old)
        if count == 0:
            raise WorkspaceError(f"old_text introuvable dans {normalized}")
        if count > 1:
            raise WorkspaceError(
                f"old_text apparaît {count} fois dans {normalized} : "
                "ajoute du contexte pour le rendre unique"
            )
        resolved.write_bytes(content.replace(old, new, 1).encode("utf-8"))
        self.touched.add(normalized)

    def create(self, path: str, content: str) -> None:
        normalized, resolved = self._resolve(path)
        if self.editable is None:
            raise WorkspaceError("ce mode est en lecture seule")
        if resolved.exists():
            raise WorkspaceError(f"le fichier existe déjà : {normalized}")
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_bytes(content.encode("utf-8"))
        self.created.add(normalized)
        self.touched.add(normalized)

    def delete(self, path: str) -> None:
        normalized, resolved = self._resolve(path)
        self._check_editable(normalized)
        if not resolved.is_file():
            raise WorkspaceError(f"fichier introuvable : {normalized}")
        resolved.unlink()
        self.touched.add(normalized)


class GitHubWorkspace(Workspace):
    """Read-only view of a repository at a fixed commit, through the REST API."""

    max_search_files = MAX_REMOTE_SEARCH_FILES

    def __init__(self, client: GitHubClient, repo: str, ref: str, config: Config):
        super().__init__(config)
        self.client = client
        self.repo = repo
        self.ref = ref
        self._files: list[str] | None = None
        self._cache: dict[str, str] = {}

    def _all_files(self) -> list[str]:
        if self._files is None:
            self._files = self.client.list_tree(self.repo, self.ref)
        return self._files

    def read(self, path: str) -> str:
        normalized = normalize_path(path)
        if normalized not in self._cache:
            data = self.client.get_file(self.repo, normalized, self.ref)
            self._cache[normalized] = _decode(normalized, data)
        return self._cache[normalized]
