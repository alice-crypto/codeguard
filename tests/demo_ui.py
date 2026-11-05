"""Démo de l'interface sans clé ni réseau : dépôt d'exemple, faux Claude et faux GitHub.

python tests/demo_ui.py [port]
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from codeguard.ui.server import create_server
from conftest import FakeAnthropic, FakeGitHub, final, reply, tool, tool_result_seen

SOURCE_BEFORE = """\
import json
import os


def load_users(path):
    with open(path) as handle:
        return json.load(handle)
"""

SOURCE_AFTER = """\
import json
import os


def load_users(path):
    with open(path) as handle:
        return json.load(handle)


def find_user(users, name):
    for user in users:
        if user["name"] == name:
            return user


def average_age(users):
    total = 0
    for user in users:
        total = total + user["age"]
    return total / len(users)


def run_report(name):
    os.system("report " + name)
"""


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def build_repo(base: Path) -> Path:
    root = base / "projet-demo"
    root.mkdir()
    git(root, "init", "--initial-branch=main")
    git(root, "config", "user.name", "Demo")
    git(root, "config", "user.email", "demo@example.com")
    git(root, "config", "core.autocrlf", "false")
    (root / "users.py").write_bytes(SOURCE_BEFORE.encode())
    (root / ".codeguard.toml").write_text('[codeguard]\nchecks = ["git --version"]\n', "utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-m", "init")
    git(root, "checkout", "-b", "feature/rapport")
    (root / "users.py").write_bytes(SOURCE_AFTER.encode())
    git(root, "commit", "-am", "Ajoute le rapport")
    remote = base / "remote.git"
    git(base, "init", "--bare", str(remote))
    git(root, "remote", "add", "origin", "https://github.com/acme/app.git")
    git(root, "remote", "set-url", "--push", "origin", str(remote))
    return root


FINDINGS = [
    {
        "path": "users.py",
        "line": 23,
        "end_line": 23,
        "severity": "critical",
        "category": "security",
        "confidence": "high",
        "title": "Injection de commande via name",
        "explanation": (
            "name est concaténé dans une commande shell : "
            "`x; rm -rf ~` exécute la seconde commande."
        ),
        "suggested_code": '    subprocess.run(["report", name], check=True)',
    },
    {
        "path": "users.py",
        "line": 19,
        "end_line": 19,
        "severity": "high",
        "category": "bug",
        "confidence": "high",
        "title": "Division par zéro sur une liste vide",
        "explanation": "average_age([]) lève ZeroDivisionError au lieu de renvoyer une valeur.",
        "suggested_code": "    return total / len(users) if users else 0",
    },
    {
        "path": "users.py",
        "line": 12,
        "end_line": 12,
        "severity": "low",
        "category": "maintainability",
        "confidence": "low",
        "title": (
            "Texte hostile : <img src=x onerror=\"document.title='XSS'\"><script>alert(1)</script>"
        ),
        "explanation": "Ce titre vérifie que le contenu du dépôt reste affiché comme du texte.",
        "suggested_code": "",
    },
    {
        "path": "users.py",
        "line": 999,
        "end_line": 999,
        "severity": "medium",
        "category": "bug",
        "confidence": "medium",
        "title": "Remarque sur une ligne inventée",
        "explanation": "Elle doit être écartée par la validation.",
        "suggested_code": "",
    },
]


def responder(request: dict) -> dict:
    time.sleep(0.8)
    is_clean = request["system"].startswith("You clean code")
    if not tool_result_seen(request):
        if is_clean:
            return reply(
                tool(
                    "edit_file",
                    {
                        "path": "users.py",
                        "old_text": "    total = 0\n    for user in users:\n"
                        '        total = total + user["age"]\n    return total / len(users)\n',
                        "new_text": '    return sum(user["age"] for user in users) / len(users)\n',
                    },
                ),
                stop="tool_use",
            )
        return reply(tool("read_file", {"path": "users.py"}), stop="tool_use")
    if is_clean:
        return final(
            {
                "summary": "average_age simplifiée, sans changement de comportement.",
                "changes": [
                    {
                        "path": "users.py",
                        "kind": "simplification",
                        "description": "Boucle remplacée par sum().",
                    }
                ],
                "left_alone": ["run_report : injection de commande, à corriger séparément."],
            },
            input_tokens=4200,
            output_tokens=380,
        )
    return final(
        {
            "summary": "Le nouveau rapport introduit une injection de commande et un cas d'erreur.",
            "findings": FINDINGS,
        },
        input_tokens=5800,
        output_tokens=640,
    )


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    base = Path(tempfile.mkdtemp(prefix="codeguard-demo-"))
    root = build_repo(base)

    fake_api = FakeAnthropic()
    fake_api.responder = responder
    fake_github = FakeGitHub()
    fake_github.files = {"users.py": SOURCE_AFTER}
    fake_github.diff = (
        "diff --git a/users.py b/users.py\n--- a/users.py\n+++ b/users.py\n"
        "@@ -7,0 +8,2 @@\n+\n+# demo\n"
    )
    os.environ.update(
        ANTHROPIC_API_KEY="demo-key",
        ANTHROPIC_BASE_URL=fake_api.url,
        GITHUB_API_URL=fake_github.url,
        GITHUB_TOKEN="demo-token",
    )
    server = create_server(port=port, token="demo")
    print(f"Dépôt d'exemple : {root}", flush=True)
    print(f"Interface : {server.launch_url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
