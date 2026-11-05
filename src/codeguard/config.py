"""Chargement de la configuration `.codeguard.toml`."""

from __future__ import annotations

import fnmatch
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

CONFIG_FILENAME = ".codeguard.toml"

SEVERITIES = ("critical", "high", "medium", "low", "info")
EFFORTS = ("low", "medium", "high", "xhigh", "max")

DEFAULT_EXCLUDES = (
    "*.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "*.min.js",
    "*.min.css",
    "*.map",
    "node_modules/*",
    "vendor/*",
    "dist/*",
    "build/*",
    ".venv/*",
)

# Never sent to the API, whatever the repository configuration says.
SENSITIVE_PATTERNS = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa*",
    "id_ed25519*",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "credentials*",
    "secrets.*",
)
SENSITIVE_ALLOWED_SUFFIXES = (".example", ".sample", ".template", ".dist")


class ConfigError(Exception):
    pass


def is_sensitive(path: str) -> bool:
    name = path.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if name.endswith(SENSITIVE_ALLOWED_SUFFIXES):
        return False
    return any(fnmatch.fnmatch(name, pattern) for pattern in SENSITIVE_PATTERNS)


@dataclass
class Config:
    model: str = "claude-opus-5-5"
    effort: str = "high"
    language: str = "français"
    max_turns: int = 40
    max_cost_usd: float = 5.0
    min_severity: str = "low"
    instructions: str = ""
    exclude: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    checks: list[str] = field(default_factory=list)
    formatters: list[str] = field(default_factory=list)

    def is_excluded(self, path: str) -> bool:
        path = path.replace("\\", "/")
        name = path.rsplit("/", 1)[-1]
        return any(
            fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(name, pattern)
            for pattern in self.exclude
        )

    def validate(self) -> None:
        if self.effort not in EFFORTS:
            raise ConfigError(f"effort invalide : {self.effort!r} (attendu : {', '.join(EFFORTS)})")
        if self.min_severity not in SEVERITIES:
            raise ConfigError(
                f"min_severity invalide : {self.min_severity!r} (attendu : {', '.join(SEVERITIES)})"
            )
        if self.max_turns < 1:
            raise ConfigError("max_turns doit être supérieur ou égal à 1")
        if self.max_cost_usd <= 0:
            raise ConfigError("max_cost_usd doit être strictement positif")


def parse_config(text: str, source: str = CONFIG_FILENAME) -> Config:
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{source} : TOML invalide ({exc})") from exc

    section = dict(data.get("codeguard", {}))
    # `extra_exclude` adds to the defaults, whereas `exclude` replaces them.
    extra_exclude = section.pop("extra_exclude", None)
    known = {f.name for f in fields(Config)}
    unknown = set(section) - known
    if unknown:
        raise ConfigError(f"{source} : clés inconnues : {', '.join(sorted(unknown))}")

    config = Config()
    for key, value in section.items():
        expected = type(getattr(config, key))
        if expected is float and isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        if not isinstance(value, expected):
            raise ConfigError(f"{source} : {key} doit être de type {expected.__name__}")
        setattr(config, key, value)
    if extra_exclude:
        config.exclude.extend(extra_exclude)
    config.validate()
    return config


def load_config(root: Path, explicit: Path | None = None) -> Config:
    path = explicit or root / CONFIG_FILENAME
    if not path.is_file():
        if explicit:
            raise ConfigError(f"fichier de configuration introuvable : {explicit}")
        return Config()
    return parse_config(path.read_text(encoding="utf-8"), source=str(path))
