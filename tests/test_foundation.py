import sys
import urllib.request

import pytest

from codeguard import gitops
from codeguard.config import Config, ConfigError, is_sensitive, parse_config
from codeguard.diffparse import parse_diff
from codeguard.github import GitHubClient, GitHubError, _SameHostRedirect
from codeguard.tools import ToolBox, run_command
from codeguard.workspace import LocalWorkspace, WorkspaceError
from conftest import run_git

DIFF = """\
diff --git a/src/a.py b/src/a.py
index 1..2 100644
--- a/src/a.py
+++ b/src/a.py
@@ -1,3 +1,4 @@
 one
+two
 three
 four
@@ -10,2 +11,2 @@ def f():
-old
+new
 end
diff --git a/gone.py b/gone.py
deleted file mode 100644
--- a/gone.py
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.py b/new name.py
similarity index 100%
rename from old name.py
rename to new name.py
"""


def test_parse_diff_paths_and_counts():
    first, deleted, renamed = parse_diff(DIFF)
    assert (first.path, first.added, first.removed) == ("src/a.py", 2, 1)
    assert deleted.path == "gone.py" and deleted.deleted
    assert renamed.path == "new name.py"


def test_comments_must_stay_within_one_hunk():
    first = parse_diff(DIFF)[0]
    assert first.can_comment(2)
    assert first.can_comment(1, 4)
    assert first.can_comment(11, 12)
    assert not first.can_comment(4, 11)  # both lines exist, but in different hunks
    assert not first.can_comment(8)


def test_untracked_files_appear_in_the_diff(repo):
    (repo / "fresh.py").write_text("x = 1\n", "utf-8")
    (repo / "app.py").write_text("changed\n", "utf-8")
    files = {file.path: file for file in parse_diff(gitops.diff_uncommitted(repo))}
    assert set(files) == {"app.py", "fresh.py"}
    assert files["fresh.py"].added == 1


@pytest.mark.parametrize(
    "path", ["../outside.txt", "a/../../b", "/etc/passwd", "C:/Windows/x", ".git/config", ".env"]
)
def test_paths_outside_the_contract_are_refused(repo, path):
    with pytest.raises(WorkspaceError):
        LocalWorkspace(repo, Config()).read(path)


def test_symlink_escaping_the_root_is_refused(repo, tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("x", "utf-8")
    link = repo / "link.txt"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("création de liens symboliques non autorisée ici")
    with pytest.raises(WorkspaceError, match="hors du dépôt"):
        LocalWorkspace(repo, Config()).read("link.txt")


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (".env", True),
        ("config/.env.production", True),
        ("deploy/server.pem", True),
        (".env.example", False),
        ("src/environment.py", False),
    ],
)
def test_sensitive_files(path, expected):
    assert is_sensitive(path) is expected


def test_sensitive_files_are_not_listed_or_searched(repo):
    (repo / ".env.local").write_text("TOKEN=abc\n", "utf-8")
    run_git(repo, "add", "-f", ".env.local")
    workspace = LocalWorkspace(repo, Config())
    assert ".env.local" not in workspace.list_files()
    assert workspace.search("TOKEN")[0] == []


def test_edit_is_limited_to_the_scope(repo):
    workspace = LocalWorkspace(repo, Config(), editable={"app.py"})
    workspace.edit("app.py", "import os\n", "")
    assert "import os" not in (repo / "app.py").read_text("utf-8")
    with pytest.raises(WorkspaceError, match="hors du périmètre"):
        workspace.edit("other.py", "VALUE", "NAME")
    with pytest.raises(WorkspaceError, match="hors du périmètre"):
        workspace.delete("other.py")
    assert (repo / "other.py").exists()


def test_read_only_workspace_rejects_writes(repo):
    workspace = LocalWorkspace(repo, Config())
    with pytest.raises(WorkspaceError, match="lecture seule"):
        workspace.edit("app.py", "a", "b")
    with pytest.raises(WorkspaceError, match="lecture seule"):
        workspace.create("new.py", "")


def test_edit_keeps_crlf_line_endings(repo):
    (repo / "win.py").write_bytes(b"a = 1\r\nb = 2\r\nc = 3\r\n")
    workspace = LocalWorkspace(repo, Config(), editable={"win.py"})
    workspace.edit("win.py", "a = 1\nb = 2\n", "a = 10\nb = 20\n")
    assert (repo / "win.py").read_bytes() == b"a = 10\r\nb = 20\r\nc = 3\r\n"


def test_edit_requires_a_unique_match(repo):
    (repo / "dup.py").write_text("x\nx\n", "utf-8")
    workspace = LocalWorkspace(repo, Config(), editable={"dup.py"})
    with pytest.raises(WorkspaceError, match="2 fois"):
        workspace.edit("dup.py", "x", "y")


def test_read_tool_reports_remaining_lines(repo):
    (repo / "long.py").write_text("".join(f"l{i}\n" for i in range(10)), "utf-8")
    box = ToolBox(LocalWorkspace(repo, Config()))
    content, is_error = box.execute("read_file", {"path": "long.py", "offset": 2, "limit": 3})
    assert not is_error
    assert content.splitlines()[:3] == ["2\tl1", "3\tl2", "4\tl3"]
    assert "offset=5" in content


def test_tool_input_is_validated_before_running(repo):
    box = ToolBox(LocalWorkspace(repo, Config(), editable={"app.py"}))
    before = (repo / "app.py").read_text("utf-8")
    content, is_error = box.execute("edit_file", {"path": "app.py", "old_text": "import os"})
    assert is_error and "INVALID_JSON" in content
    assert (repo / "app.py").read_text("utf-8") == before


def test_read_only_toolbox_has_no_write_tools(repo):
    names = {d["name"] for d in ToolBox(LocalWorkspace(repo, Config())).definitions()}
    assert names == {"list_files", "read_file", "search_code"}


def test_checks_tool_only_exists_in_edit_mode_with_checks(repo):
    box = ToolBox(LocalWorkspace(repo, Config(), editable={"app.py"}), checks=["x"])
    assert "run_checks" in {d["name"] for d in box.definitions()}
    box = ToolBox(LocalWorkspace(repo, Config()), checks=["x"])
    assert "run_checks" not in {d["name"] for d in box.definitions()}


def test_tool_definitions_are_stable_and_streamed(repo):
    box = ToolBox(LocalWorkspace(repo, Config()))
    definitions = box.definitions()
    assert [d["name"] for d in definitions] == sorted(d["name"] for d in definitions)
    assert all(d["eager_input_streaming"] for d in definitions)
    assert not any("eager_input_streaming" in d for d in box.definitions(eager=False))


def test_commands_do_not_receive_credentials(repo, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    monkeypatch.setenv("GITHUB_TOKEN", "gh-secret")
    script = repo / "env.py"
    script.write_text(
        "import os\nprint(os.environ.get('ANTHROPIC_API_KEY'), os.environ.get('GITHUB_TOKEN'))\n",
        "utf-8",
    )
    passed, output = run_command(f'"{sys.executable}" env.py', repo)
    assert passed
    assert "secret" not in output


def test_missing_command_is_a_failure(repo):
    passed, output = run_command("commande-qui-n-existe-pas --x", repo)
    assert not passed and "introuvable" in output


def test_config_parsing():
    config = parse_config(
        '[codeguard]\neffort = "max"\nmax_cost_usd = 2\nextra_exclude = ["gen/*"]\n'
    )
    assert config.effort == "max"
    assert config.max_cost_usd == 2.0
    assert config.is_excluded("gen/x.py") and config.is_excluded("poetry.lock")
    assert not config.is_excluded("src/x.py")


@pytest.mark.parametrize(
    "text",
    [
        '[codeguard]\neffort = "extreme"\n',
        "[codeguard]\nunknown = 1\n",
        '[codeguard]\nmax_turns = "many"\n',
        "not toml =",
    ],
)
def test_bad_config_is_rejected(text):
    with pytest.raises(ConfigError):
        parse_config(text)


def test_token_is_refused_over_plain_http():
    with pytest.raises(GitHubError, match="HTTPS"):
        GitHubClient(token="x", api_url="http://github.example.com")


def test_token_is_not_forwarded_to_another_host():
    handler = _SameHostRedirect()
    request = urllib.request.Request(
        "https://api.github.com/a", headers={"Authorization": "Bearer x"}
    )
    same = handler.redirect_request(request, None, 302, "", {}, "https://api.github.com/b")
    other = handler.redirect_request(request, None, 302, "", {}, "https://evil.example.com/b")
    assert same.get_header("Authorization") == "Bearer x"
    assert other.get_header("Authorization") is None
