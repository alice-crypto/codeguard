"""Analyse de diffs unifiés : découpage par fichier et lignes commentables."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

_FILE_HEADER = re.compile(r"^diff --git ", re.MULTILINE)
_HUNK_HEADER = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


@dataclass
class FileDiff:
    path: str
    text: str
    added: int = 0
    removed: int = 0
    deleted: bool = False
    # One set of new-side line numbers per hunk: GitHub only accepts a multi-line
    # comment when both of its ends belong to the same hunk.
    hunks: list[set[int]] = field(default_factory=list)

    def can_comment(self, line: int, end_line: int | None = None) -> bool:
        end = end_line if end_line is not None else line
        return any(line in hunk and end in hunk for hunk in self.hunks)


def _clean_path(raw: str) -> str:
    raw = raw.split("\t", 1)[0].strip()
    if raw.startswith('"') and raw.endswith('"'):
        raw = raw[1:-1]
    if raw[:2] in ("a/", "b/"):
        raw = raw[2:]
    return raw


def _path_from_header(first_line: str) -> str:
    rest = first_line[len("diff --git ") :].strip()
    if rest.startswith('"'):
        return _clean_path(rest.rsplit('" ', 1)[-1].strip('"'))
    # "a/x y b/x y": both sides are identical unless renamed, in which case the
    # "rename to" or "+++" lines win before this fallback is used.
    middle = len(rest) // 2
    return _clean_path(rest[middle + 1 :])


def parse_file_diff(text: str) -> FileDiff:
    lines = text.splitlines()
    path = ""
    old_path = ""
    file_diff = FileDiff(path="", text=text)
    index = 0
    while index < len(lines) and not lines[index].startswith("@@"):
        line = lines[index]
        if line.startswith("+++ ") and "/dev/null" not in line:
            path = _clean_path(line[4:])
        elif line.startswith("--- ") and "/dev/null" not in line:
            old_path = _clean_path(line[4:])
        elif line.startswith("+++ /dev/null") or line.startswith("deleted file mode"):
            file_diff.deleted = True
        elif line.startswith("rename to "):
            path = _clean_path(line[len("rename to ") :])
        index += 1

    while index < len(lines):
        match = _HUNK_HEADER.match(lines[index])
        index += 1
        if not match:
            continue
        new_line = int(match.group(1))
        remaining = int(match.group(2)) if match.group(2) is not None else 1
        hunk: set[int] = set()
        while remaining > 0 and index < len(lines):
            line = lines[index]
            index += 1
            if line.startswith("-"):
                file_diff.removed += 1
            elif line.startswith("\\"):
                continue
            else:
                if line.startswith("+"):
                    file_diff.added += 1
                hunk.add(new_line)
                new_line += 1
                remaining -= 1
        file_diff.hunks.append(hunk)

    file_diff.path = path or old_path or (_path_from_header(lines[0]) if lines else "")
    return file_diff


def parse_diff(diff: str) -> list[FileDiff]:
    starts = [match.start() for match in _FILE_HEADER.finditer(diff)]
    sections = [
        diff[start : starts[position + 1] if position + 1 < len(starts) else len(diff)]
        for position, start in enumerate(starts)
    ]
    return [parse_file_diff(section) for section in sections]


def filter_files(files: list[FileDiff], keep: Callable[[str], bool]) -> list[FileDiff]:
    return [file for file in files if keep(file.path)]


def render_stat(files: list[FileDiff]) -> str:
    return "\n".join(
        f"{file.path} (+{file.added} -{file.removed}{', supprimé' if file.deleted else ''})"
        for file in files
    )
