"""Outils exposés au modèle. Chaque entrée est validée avant exécution."""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from codeguard.diffparse import FileDiff
from codeguard.github import GitHubError
from codeguard.workspace import LocalWorkspace, Workspace, WorkspaceError

MAX_RESULT_CHARS = 60_000
DEFAULT_READ_LINES = 500
CHECK_TIMEOUT_SECONDS = 900
CHECK_OUTPUT_CHARS = 8_000

# Checks run the repository's code: they get no credentials from this process.
_SECRET_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN")


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ListFiles(_Input):
    path: str = Field("", description="Dossier relatif à la racine ; vide pour tout le dépôt.")


class ReadFile(_Input):
    path: str = Field(description="Chemin relatif à la racine.")
    offset: int = Field(1, description="Première ligne à lire (à partir de 1).")
    limit: int = Field(DEFAULT_READ_LINES, description="Nombre de lignes à lire.")


class SearchCode(_Input):
    pattern: str = Field(description="Expression régulière Python, appliquée ligne par ligne.")
    path: str = Field("", description="Dossier auquel limiter la recherche.")


class GetDiff(_Input):
    path: str = Field(description="Fichier dont on veut le diff.")


class EditFile(_Input):
    path: str = Field(description="Fichier à modifier.")
    old_text: str = Field(description="Texte exact à remplacer ; doit être unique dans le fichier.")
    new_text: str = Field(description="Texte de remplacement.")


class CreateFile(_Input):
    path: str = Field(description="Nouveau fichier ; il ne doit pas déjà exister.")
    content: str = Field(description="Contenu complet du fichier.")


class DeleteFile(_Input):
    path: str = Field(description="Fichier à supprimer.")


class RunChecks(_Input):
    pass


def run_command(command: str, cwd: Path) -> tuple[bool, str]:
    """Run a configured command without a shell and return (success, output tail)."""
    argv = shlex.split(command, posix=os.name != "nt")
    argv = [arg.strip('"') for arg in argv]
    executable = shutil.which(argv[0], path=os.environ.get("PATH")) if argv else None
    if not executable:
        return False, f"commande introuvable : {command}"
    env = {key: value for key, value in os.environ.items() if key not in _SECRET_ENV}
    try:
        result = subprocess.run(
            [executable, *argv[1:]],
            cwd=cwd,
            env=env,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=CHECK_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return False, f"délai dépassé ({CHECK_TIMEOUT_SECONDS} s) : {command}"
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output[-CHECK_OUTPUT_CHARS:]


def run_checks(commands: list[str], cwd: Path) -> tuple[bool, str]:
    success = True
    reports = []
    for command in commands:
        passed, output = run_command(command, cwd)
        success = success and passed
        reports.append(f"$ {command}\n[{'OK' if passed else 'ÉCHEC'}]\n{output}")
    return success, "\n\n".join(reports)


@dataclass
class _Tool:
    description: str
    model: type[_Input]
    handler: Callable


class ToolBox:
    def __init__(
        self,
        workspace: Workspace,
        files: list[FileDiff] | None = None,
        checks: list[str] | None = None,
    ):
        self.workspace = workspace
        self.diffs = {file.path: file for file in files or []}
        self.checks = checks or []
        self._tools: dict[str, _Tool] = {
            "list_files": _Tool(
                "Liste les fichiers suivis du dépôt, éventuellement sous un dossier.",
                ListFiles,
                self._list_files,
            ),
            "read_file": _Tool(
                "Lit un fichier avec ses numéros de ligne.", ReadFile, self._read_file
            ),
            "search_code": _Tool(
                "Cherche une expression régulière dans le dépôt.", SearchCode, self._search
            ),
        }
        if self.diffs:
            self._tools["get_diff"] = _Tool(
                "Renvoie le diff d'un fichier modifié.", GetDiff, self._get_diff
            )
        if isinstance(workspace, LocalWorkspace) and workspace.editable is not None:
            self._tools.update(
                edit_file=_Tool(
                    "Remplace un texte exact et unique dans un fichier du périmètre.",
                    EditFile,
                    self._edit,
                ),
                create_file=_Tool(
                    "Crée un nouveau fichier, par exemple pour une extraction.",
                    CreateFile,
                    self._create,
                ),
                delete_file=_Tool(
                    "Supprime un fichier du périmètre devenu inutile.", DeleteFile, self._delete
                ),
            )
            if self.checks:
                self._tools["run_checks"] = _Tool(
                    "Lance les vérifications configurées par le projet (tests, linters).",
                    RunChecks,
                    self._run_checks,
                )

    def definitions(self, eager: bool = True) -> list[dict]:
        definitions = []
        for name in sorted(self._tools):  # stable order keeps the prompt cache valid
            tool = self._tools[name]
            definition = {
                "name": name,
                "description": tool.description,
                "input_schema": tool.model.model_json_schema(),
            }
            if eager:
                definition["eager_input_streaming"] = True
            definitions.append(definition)
        return definitions

    def execute(self, name: str, raw_input: object) -> tuple[str, bool]:
        """Return (content, is_error). A bad input never reaches the handler."""
        tool = self._tools.get(name)
        if tool is None:
            return f"Outil inconnu : {name}", True
        try:
            parsed = tool.model.model_validate(raw_input)
        except ValidationError:
            return json.dumps({"INVALID_JSON": raw_input}, ensure_ascii=False, default=str), True
        try:
            result = tool.handler(parsed)
        except (WorkspaceError, GitHubError, OSError, re.error) as exc:
            return f"Erreur : {exc}", True
        if len(result) > MAX_RESULT_CHARS:
            omitted = len(result) - MAX_RESULT_CHARS
            result = (
                f"{result[:MAX_RESULT_CHARS]}\n"
                f"[{omitted} caractères omis : affine la demande pour voir la suite]"
            )
        return result, False

    def _list_files(self, params: ListFiles) -> str:
        return "\n".join(self.workspace.list_files(params.path)) or "(aucun fichier)"

    def _read_file(self, params: ReadFile) -> str:
        lines = self.workspace.read(params.path).splitlines()
        start = max(params.offset, 1)
        end = start + max(params.limit, 1) - 1
        selected = lines[start - 1 : end]
        body = "\n".join(f"{number}\t{line}" for number, line in enumerate(selected, start=start))
        if end < len(lines):
            body += f"\n[{len(lines) - end} lignes suivantes : continue avec offset={end + 1}]"
        return body or "(fichier vide ou offset au-delà de la fin)"

    def _search(self, params: SearchCode) -> str:
        matches, note = self.workspace.search(params.pattern, params.path)
        body = "\n".join(matches) or "(aucun résultat)"
        return f"{body}\n[{note}]" if note else body

    def _get_diff(self, params: GetDiff) -> str:
        path = params.path.replace("\\", "/")
        if path not in self.diffs:
            raise WorkspaceError(f"pas de diff pour : {params.path}")
        return self.diffs[path].text

    def _edit(self, params: EditFile) -> str:
        self.workspace.edit(params.path, params.old_text, params.new_text)
        return f"{params.path} modifié."

    def _create(self, params: CreateFile) -> str:
        self.workspace.create(params.path, params.content)
        return f"{params.path} créé."

    def _delete(self, params: DeleteFile) -> str:
        self.workspace.delete(params.path)
        return f"{params.path} supprimé."

    def _run_checks(self, _params: RunChecks) -> str:
        return run_checks(self.checks, self.workspace.root)[1]
