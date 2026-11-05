"""Scénarios de bout en bout : CLI, vrai dépôt git, faux serveurs Anthropic et GitHub."""

import json
import sys
from datetime import datetime

import pytest

from codeguard.agent import AgentSettings, Usage
from codeguard.clean import CleanRequest, run_clean
from codeguard.cli import main
from codeguard.config import Config
from codeguard.diffparse import parse_diff
from codeguard.review import (
    ReviewReport,
    ReviewTarget,
    build_review_payload,
    fingerprint,
    validate_findings,
)
from codeguard.schemas import Finding
from codeguard.workspace import LocalWorkspace
from conftest import final, reply, run_git, tool

SETTINGS = AgentSettings("claude-opus-5-5", "high", 10, 5.0)
CLEAN_OK = {"summary": "Import retiré", "changes": [], "left_alone": []}


def finding(**kwargs) -> dict:
    values = {
        "path": "app.py",
        "line": 5,
        "end_line": 5,
        "severity": "high",
        "category": "bug",
        "confidence": "high",
        "title": "Résultat incorrect",
        "explanation": "Avec a=1, la fonction renvoie une mauvaise valeur.",
        "suggested_code": "",
    }
    return {**values, **kwargs}


@pytest.fixture
def cli_env(fake_api, repo, monkeypatch):
    monkeypatch.chdir(repo)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", fake_api.url)
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    return fake_api


# --- Review locale


def test_review_of_uncommitted_changes(cli_env, repo, capsys):
    (repo / "app.py").write_text("def add(a, b):\n    return a - b\n", "utf-8")
    cli_env.replies = [final({"summary": "Un bug", "findings": [finding(line=2, end_line=2)]})]
    assert main(["review", "--fail-on", "high", "-q"]) == 1
    output = capsys.readouterr().out
    assert "app.py:2" in output and "Un bug" in output
    prompt = cli_env.requests[0]["messages"][0]["content"]
    assert "return a - b" in prompt
    assert not any(t["name"] in ("edit_file", "run_checks") for t in cli_env.requests[0]["tools"])


def test_fail_on_threshold_is_respected(cli_env, repo):
    (repo / "app.py").write_text("x = 1\n", "utf-8")
    cli_env.replies = [
        final({"summary": "", "findings": [finding(line=1, end_line=1, severity="low")]})
    ]
    assert main(["review", "--fail-on", "high", "-q"]) == 0


def test_secret_files_never_reach_the_model(cli_env, repo):
    (repo / "app.py").write_text("x = 1\n", "utf-8")
    (repo / ".env").write_text("SECRET=hunter2\n", "utf-8")
    run_git(repo, "add", "-f", ".env", "app.py")
    cli_env.replies = [final({"summary": "ok", "findings": []})]
    assert main(["review", "--staged", "-q"]) == 0
    sent = json.dumps(cli_env.requests[0])
    assert "x = 1" in sent
    assert "hunter2" not in sent and ".env" not in sent


def test_nothing_to_review_makes_no_api_call(cli_env, repo):
    run_git(repo, "branch", "origin/main")
    assert main(["review", "--base", "main", "-q"]) == 0
    assert cli_env.requests == []


def test_invalid_base_ref_is_reported(cli_env, capsys):
    assert main(["review", "--base=--upload-pack=evil", "-q"]) == 2
    assert "invalide" in capsys.readouterr().err


def test_audit_of_paths(cli_env):
    cli_env.replies = [final({"summary": "ok", "findings": []})]
    assert main(["review", "--paths", "app.py", "-q"]) == 0
    prompt = cli_env.requests[0]["messages"][0]["content"]
    assert "app.py" in prompt and "other.py" not in prompt


def test_sarif_report_is_valid_json(cli_env, repo, tmp_path):
    (repo / "app.py").write_text("x = 1\n", "utf-8")
    cli_env.replies = [
        final({"summary": "", "findings": [finding(line=1, end_line=1, severity="critical")]})
    ]
    output = tmp_path / "out.sarif"
    assert main(["review", "--format", "sarif", "-o", str(output), "-q"]) == 0
    result = json.loads(output.read_text("utf-8"))["runs"][0]["results"][0]
    assert result["level"] == "error"
    assert result["locations"][0]["physicalLocation"]["region"]["startLine"] == 1


# --- Validation des remarques


def test_findings_on_invented_lines_or_files_are_dropped(repo):
    workspace = LocalWorkspace(repo, Config())
    findings = [
        Finding(**finding(line=5)),
        Finding(**finding(line=999, end_line=999)),
        Finding(**finding(path="absent.py")),
        Finding(**finding(path=".env")),
    ]
    kept, dropped = validate_findings(findings, workspace, "low")
    assert [item.line for item in kept] == [5]
    assert len(dropped) == 3


def test_findings_are_sorted_and_filtered_by_severity(repo):
    workspace = LocalWorkspace(repo, Config())
    findings = [
        Finding(**finding(severity="info", title="a")),
        Finding(**finding(severity="low", title="b")),
        Finding(**finding(severity="critical", title="c")),
    ]
    kept, _ = validate_findings(findings, workspace, "low")
    assert [item.title for item in kept] == ["c", "b"]


# --- Publication GitHub

PR_DIFF = """\
diff --git a/calc.py b/calc.py
--- a/calc.py
+++ b/calc.py
@@ -1,2 +1,3 @@
 def add(a, b):
+    # calcul
     return a - b
"""


def payload_for(*findings_data, existing=()):
    report = ReviewReport(
        target="PR",
        summary="Résumé pour @team",
        findings=[Finding(**data) for data in findings_data],
        dropped=[],
        usage=Usage(),
        model="claude-opus-5-5",
    )
    target = ReviewTarget(description="PR", workspace=None, files=parse_diff(PR_DIFF))
    return build_review_payload(report, target, list(existing))


def test_inline_and_out_of_diff_findings_are_separated():
    body, comments, outside = payload_for(
        finding(path="calc.py", line=2, end_line=3, title="dans le diff"),
        finding(path="calc.py", line=40, end_line=40, title="hors diff"),
        finding(path="autre.py", line=1, end_line=1, title="autre fichier"),
    )
    assert len(comments) == 1
    assert comments[0]["start_line"] == 2 and comments[0]["line"] == 3
    assert {item.title for item in outside} == {"hors diff", "autre fichier"}
    assert "hors diff" in body


def test_mentions_are_defused_in_prose_but_not_in_code():
    body, comments, _ = payload_for(
        finding(
            path="calc.py",
            line=2,
            end_line=2,
            title="Prévenir @admin",
            suggested_code="@decorator\ndef f(): ...",
        )
    )
    assert "@team" not in body
    assert "@admin" not in comments[0]["body"]
    assert "@decorator" in comments[0]["body"]
    assert "```suggestion" in comments[0]["body"]


def test_already_posted_findings_are_skipped():
    data = finding(path="calc.py", line=2, end_line=2)
    marker = f"<!-- codeguard:{fingerprint(Finding(**data))} -->"
    _, comments, outside = payload_for(data, existing=[f"ancien commentaire {marker}"])
    assert comments == [] and outside == []


def test_pull_request_review_end_to_end(cli_env, fake_github, monkeypatch, capsys, tmp_path):
    monkeypatch.chdir(tmp_path)  # no checkout at all, as in the GitHub Action
    monkeypatch.setenv("GITHUB_API_URL", fake_github.url)
    monkeypatch.setenv("GITHUB_TOKEN", "gh-token")
    monkeypatch.setenv("GITHUB_REPOSITORY", fake_github.repo)
    fake_github.diff = PR_DIFF
    fake_github.files = {"calc.py": "def add(a, b):\n    # calcul\n    return a - b\n"}
    fake_github.base_files = {".codeguard.toml": '[codeguard]\ninstructions = "Règle de la base"\n'}
    cli_env.replies = [
        reply(tool("read_file", {"path": "calc.py"}), stop="tool_use"),
        final(
            {
                "summary": "Soustraction",
                "findings": [
                    finding(path="calc.py", line=3, end_line=3, suggested_code="    return a + b")
                ],
            }
        ),
    ]
    assert main(["review", "--pr", "7", "--post", "--fail-on", "high", "-q"]) == 1

    review = fake_github.reviews[0]
    assert review["event"] == "COMMENT"
    assert review["commit_id"] == "headsha"
    assert review["comments"][0]["path"] == "calc.py" and review["comments"][0]["line"] == 3
    assert "```suggestion\n    return a + b\n```" in review["comments"][0]["body"]
    assert set(fake_github.authorization) == {"Bearer gh-token"}

    request = cli_env.requests[0]
    assert "Règle de la base" in request["system"]
    assert "<pr_description>" in request["messages"][0]["content"]
    assert "gh-token" not in json.dumps(cli_env.requests)
    assert "publié" in capsys.readouterr().out.lower()


def test_post_requires_a_pull_request(cli_env, capsys):
    assert main(["review", "--post", "-q"]) == 2
    assert "--pr" in capsys.readouterr().err


# --- Nettoyage


def clean_request(repo, **kwargs):
    values = {"target": "test", "start": "HEAD", "files": ["app.py"]}
    return CleanRequest(**{**values, **kwargs})


REMOVE_IMPORT = reply(
    tool(
        "edit_file",
        {"path": "app.py", "old_text": "import os\n\n\n", "new_text": ""},
    ),
    stop="tool_use",
)


def test_clean_commits_on_a_branch_and_leaves_the_tree_alone(fake_api, repo):
    (repo / "wip.txt").write_text("travail en cours\n", "utf-8")
    head = run_git(repo, "rev-parse", "HEAD").strip()
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]

    report = run_clean(fake_api.client(), repo, clean_request(repo), Config(), SETTINGS, print)

    assert report.status == "committed"
    assert "import os" in (repo / "app.py").read_text("utf-8")
    assert (repo / "wip.txt").exists()
    assert run_git(repo, "rev-parse", "HEAD").strip() == head
    assert "import os" not in run_git(repo, "show", f"{report.branch}:app.py")
    assert "codeguard" not in run_git(repo, "worktree", "list")


def test_two_cleanups_in_the_same_second_get_their_own_branch(fake_api, repo, monkeypatch):
    class FrozenClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, tzinfo=tz)

    monkeypatch.setattr("codeguard.clean.datetime", FrozenClock)
    branches = set()
    for _ in range(2):
        fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
        report = run_clean(fake_api.client(), repo, clean_request(repo), Config(), SETTINGS, print)
        assert report.status == "committed"
        branches.add(report.branch)
    assert len(branches) == 2


def test_clean_cannot_touch_files_outside_scope(fake_api, repo):
    fake_api.replies = [
        reply(
            tool("edit_file", {"path": "other.py", "old_text": "VALUE", "new_text": "X"}),
            stop="tool_use",
        ),
        final(CLEAN_OK),
    ]
    report = run_clean(fake_api.client(), repo, clean_request(repo), Config(), SETTINGS, print)
    assert report.status == "no_change"
    assert report.branch is None
    result = fake_api.requests[1]["messages"][2]["content"][0]
    assert result["is_error"] is True and "périmètre" in result["content"]
    assert "codeguard" not in run_git(repo, "branch")


def test_dry_run_keeps_nothing(fake_api, repo):
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    report = run_clean(
        fake_api.client(), repo, clean_request(repo, dry_run=True), Config(), SETTINGS, print
    )
    assert report.status == "dry_run"
    assert "-import os" in report.diff
    assert "codeguard" not in run_git(repo, "branch")
    assert "import os" in (repo / "app.py").read_text("utf-8")


def write_check(repo, source: str) -> Config:
    (repo / "check.py").write_text(source, "utf-8")
    run_git(repo, "add", "check.py")
    run_git(repo, "commit", "--quiet", "-m", "check")
    return Config(checks=[f'"{sys.executable}" check.py'])


def test_failing_checks_after_cleaning_block_the_commit(fake_api, repo):
    # Passes while `import os` is there, fails once the agent removed it.
    config = write_check(
        repo, "import sys\nsys.exit(0 if 'import os' in open('app.py').read() else 1)\n"
    )
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    report = run_clean(
        fake_api.client(), repo, clean_request(repo, run_checks=True), config, SETTINGS, print
    )
    assert report.status == "checks_failed"
    assert report.commit is None
    assert report.worktree
    run_git(repo, "worktree", "remove", "--force", report.worktree)


def test_failing_baseline_stops_before_any_api_call(fake_api, repo):
    config = write_check(repo, "import sys\nsys.exit(1)\n")
    report = run_clean(
        fake_api.client(), repo, clean_request(repo, run_checks=True), config, SETTINGS, print
    )
    assert report.status == "baseline_failed"
    assert fake_api.requests == []
    assert "codeguard" not in run_git(repo, "branch")


def test_checks_do_not_run_without_the_flag(fake_api, repo):
    (repo / "marker.py").write_text("open('ran.txt', 'w').close()\n", "utf-8")
    run_git(repo, "add", "marker.py")
    run_git(repo, "commit", "--quiet", "-m", "marker")
    config = Config(checks=[f'"{sys.executable}" marker.py'])
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    report = run_clean(fake_api.client(), repo, clean_request(repo), config, SETTINGS, print)
    assert report.status == "committed" and not report.checks_ran
    assert all("run_checks" != t["name"] for t in fake_api.requests[0]["tools"])
    assert "ran.txt" not in run_git(repo, "ls-tree", "-r", "--name-only", report.branch)


def test_clean_cli_never_pushes_without_a_flag(cli_env, repo, capsys):
    cli_env.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    assert main(["clean", "--paths", "app.py", "-q"]) == 0
    output = capsys.readouterr().out
    assert "git merge --squash codeguard/clean-" in output
    assert "poussée" not in output
    assert "aucune vérification" in output.lower()


def test_clean_of_a_pull_request_pushes_only_on_request(
    cli_env, fake_github, repo, tmp_path, monkeypatch, capsys
):
    remote = tmp_path / "remote.git"
    run_git(tmp_path, "init", "--bare", "--quiet", str(remote))
    run_git(repo, "remote", "add", "origin", str(remote))
    run_git(repo, "push", "--quiet", "origin", "main")
    run_git(repo, "checkout", "--quiet", "-b", "feature")
    (repo / "app.py").write_text("import os\n\n\ndef add(a, b):\n    return a + b  # PR\n", "utf-8")
    run_git(repo, "commit", "--quiet", "-am", "pr")
    run_git(repo, "push", "--quiet", "origin", "HEAD:refs/pull/7/head")
    run_git(repo, "checkout", "--quiet", "main")

    monkeypatch.setenv("GITHUB_API_URL", fake_github.url)
    monkeypatch.setenv("GITHUB_TOKEN", "gh-token")
    fake_github.diff = (
        "diff --git a/app.py b/app.py\n--- a/app.py\n+++ b/app.py\n"
        "@@ -5 +5 @@\n-    return a + b\n+    return a + b  # PR\n"
    )
    args = ["clean", "--pr", "7", "--repo", fake_github.repo, "-q"]

    cli_env.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    assert main(args) == 0
    assert run_git(remote, "branch", "--list", "codeguard/*").strip() == ""
    assert fake_github.created_prs == []

    cli_env.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    assert main([*args, "--open-pr"]) == 0
    pushed = run_git(remote, "branch", "--list", "codeguard/*").strip()
    assert pushed
    content = run_git(remote, "show", f"{pushed}:app.py")
    assert "# PR" in content and "import os" not in content

    created = fake_github.created_prs[0]
    assert created["base"] == "feature" and created["head"] == pushed
    assert "gh-token" not in json.dumps(created)
    assert "https://github.test/pull/8" in capsys.readouterr().out


def test_init_does_not_overwrite(repo, monkeypatch, capsys):
    monkeypatch.chdir(repo)
    assert main(["init", "--workflow"]) == 0
    assert (repo / ".github/workflows/codeguard.yml").exists()
    (repo / ".codeguard.toml").write_text("# moi\n", "utf-8")
    assert main(["init"]) == 0
    assert (repo / ".codeguard.toml").read_text("utf-8") == "# moi\n"
