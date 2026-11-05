"""Interface graphique : contrôles d'accès, API et scénarios complets sur de vrais dépôts."""

import http.client
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from codeguard.ui.server import STATIC_DIR, create_server
from conftest import final, reply, run_git, tool

TOKEN = "test-token"
CLEAN_OK = {"summary": "Import retiré", "changes": [], "left_alone": []}
REMOVE_IMPORT = reply(
    tool("edit_file", {"path": "app.py", "old_text": "import os\n\n\n", "new_text": ""}),
    stop="tool_use",
)
FINDING = {
    "path": "calc.py",
    "line": 3,
    "end_line": 3,
    "severity": "high",
    "category": "bug",
    "confidence": "high",
    "title": "Soustraction",
    "explanation": "add(1, 1) renvoie 0.",
    "suggested_code": "",
}
PR_DIFF = """\
diff --git a/calc.py b/calc.py
--- a/calc.py
+++ b/calc.py
@@ -1,2 +1,3 @@
 def add(a, b):
+    # calcul
     return a - b
"""


class Client:
    def __init__(self, server, cookie=True):
        self.server = server
        self.cookie = f"{server.cookie_name}={TOKEN}" if cookie else None

    def request(self, method, path, body=None, headers=None, host=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.bound_port, timeout=20)
        merged = {"Host": host or f"127.0.0.1:{self.server.bound_port}"}
        if self.cookie:
            merged["Cookie"] = self.cookie
        data = None
        if body is not None:
            data = json.dumps(body)
            merged |= {"Content-Type": "application/json", "X-Codeguard": "1"}
        merged |= headers or {}
        connection.request(method, path, body=data, headers=merged)
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        return response, payload

    def get(self, path):
        response, payload = self.request("GET", path)
        return response.status, json.loads(payload)

    def post(self, path, body=None):
        response, payload = self.request("POST", path, body if body is not None else {})
        return response.status, json.loads(payload)

    def wait(self, job_id):
        deadline = time.time() + 20
        logs = []
        while time.time() < deadline:
            status, detail = self.get(f"/api/jobs/{job_id}?since={len(logs)}")
            assert status == 200
            logs += detail["logs"]
            if detail["status"] != "running":
                detail["all_logs"] = logs
                return detail
            time.sleep(0.03)
        raise AssertionError("analyse non terminée")


@pytest.fixture
def server(monkeypatch, fake_api):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", fake_api.url)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
    instance = create_server(port=0, token=TOKEN)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield instance
    instance.shutdown()
    instance.server_close()


@pytest.fixture
def client(server):
    return Client(server)


# --- Contrôles d'accès


def test_listens_only_on_loopback(server):
    assert server.server_address[0] == "127.0.0.1"


@pytest.mark.parametrize("path", ["/", "/app.js", "/api/status", "/api/jobs"])
def test_everything_requires_a_session(server, path):
    response, _ = Client(server, cookie=False).request("GET", path)
    assert response.status == 401


def test_wrong_cookie_is_refused(server):
    anonymous = Client(server, cookie=False)
    anonymous.cookie = f"{server.cookie_name}=mauvais"
    response, _ = anonymous.request("GET", "/api/status")
    assert response.status == 401


def test_token_exchange_sets_a_strict_cookie_and_cleans_the_url(server):
    response, _ = Client(server, cookie=False).request("GET", f"/?token={TOKEN}")
    assert response.status == 303
    assert response.getheader("Location") == "/"
    cookie = response.getheader("Set-Cookie")
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie


def test_wrong_token_gets_no_cookie(server):
    response, _ = Client(server, cookie=False).request("GET", "/?token=mauvais")
    assert response.status == 401
    assert response.getheader("Set-Cookie") is None


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_foreign_host_is_refused_even_with_a_session(client, method):
    # DNS rebinding: a hostile domain resolving to 127.0.0.1 carries its own Host header.
    response, _ = client.request(method, "/api/status", host="evil.example.com")
    assert response.status == 403


def test_writes_without_the_custom_header_are_refused(client):
    # What a cross-site HTML form or simple fetch is able to send.
    response, _ = client.request(
        "POST",
        "/api/secrets",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status == 403
    response, _ = client.request("POST", "/api/review", body={}, headers={"X-Codeguard": "0"})
    assert response.status == 403


def test_preflight_is_never_answered(client):
    response, _ = client.request("OPTIONS", "/api/review", headers={"Origin": "https://evil"})
    assert response.status == 501
    assert response.getheader("Access-Control-Allow-Origin") is None


def test_security_headers(client):
    response, _ = client.request("GET", "/")
    policy = response.getheader("Content-Security-Policy")
    assert "default-src 'none'" in policy and "script-src 'self'" in policy
    assert response.getheader("X-Content-Type-Options") == "nosniff"
    assert response.getheader("X-Frame-Options") == "DENY"


def test_static_files_cannot_be_escaped(client):
    for path in ["/../server.py", "/..%2fserver.py", "/static/../../cli.py"]:
        response, _ = client.request("GET", path)
        assert response.status == 404


def test_frontend_never_builds_html_from_strings():
    script = (STATIC_DIR / "app.js").read_text("utf-8")
    assert not re.search(r"innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(", script)
    page = (STATIC_DIR / "index.html").read_text("utf-8")
    assert not re.search(r"<script(?![^>]*\bsrc=)", page), "pas de script en ligne"
    assert not re.search(r"\son\w+=", page), "pas de gestionnaire en ligne"
    assert not re.search(r"https?://", page), "pas de ressource externe"


# --- Identifiants


def test_session_secrets_are_never_echoed(client, server, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    status, data = client.post(
        "/api/secrets", {"anthropic_key": "sk-session-value", "github_token": "gh-session-value"}
    )
    assert status == 200
    assert data == {"anthropic": "session", "github": "session"}
    _, overview = client.get("/api/status")
    assert "session-value" not in json.dumps(overview)
    assert list(tmp_path.iterdir()) == []

    _, data = client.post("/api/secrets", {"anthropic_key": "", "github_token": ""})
    assert data == {"anthropic": "env", "github": None}


# --- Projet


def test_project_info(client, repo):
    (repo / "wip.txt").write_text("x\n", "utf-8")
    status, info = client.post("/api/project", {"path": str(repo / ".")})
    assert status == 200
    assert info["name"] == "repo"
    assert info["branch"] == "main"
    assert info["changed_files"] == 1


def test_project_shows_the_commands_it_would_run(client, repo):
    (repo / ".codeguard.toml").write_text('[codeguard]\nchecks = ["pytest -q"]\n', "utf-8")
    _, info = client.post("/api/project", {"path": str(repo)})
    assert info["config"]["checks"] == ["pytest -q"]


def test_bad_project_paths(client, tmp_path):
    status, data = client.post("/api/project", {"path": str(tmp_path / "absent")})
    assert status == 400 and "introuvable" in data["error"]
    status, data = client.post("/api/project", {"path": str(tmp_path)})
    assert status == 400 and "git" in data["error"]


def test_invalid_config_is_reported_without_failing(client, repo):
    (repo / ".codeguard.toml").write_text('[codeguard]\neffort = "extreme"\n', "utf-8")
    status, info = client.post("/api/project", {"path": str(repo)})
    assert status == 200
    assert "effort invalide" in info["config_error"]


# --- Review


def test_local_review_end_to_end(client, fake_api, repo):
    (repo / "calc.py").write_text("def add(a, b):\n\n    return a - b\n", "utf-8")
    fake_api.replies = [final({"summary": "Un bug", "findings": [FINDING]})]
    status, job = client.post("/api/review", {"path": str(repo), "mode": "auto", "max_cost": "2"})
    assert status == 202
    detail = client.wait(job["id"])
    assert detail["status"] == "done"
    assert detail["result"]["findings"][0]["title"] == "Soustraction"
    assert detail["can_post"] is False
    assert any("cible" in line for line in detail["all_logs"])

    status, data = client.post(f"/api/jobs/{job['id']}/post")
    assert status == 400 and "pull request" in data["error"]


@pytest.mark.parametrize(
    ("fmt", "marker"),
    [("markdown", "# Review"), ("json", '"findings"'), ("sarif", '"2.1.0"'), ("text", "Review :")],
)
def test_report_export(client, fake_api, repo, fmt, marker):
    (repo / "calc.py").write_text("x = 1\n", "utf-8")
    fake_api.replies = [final({"summary": "ok", "findings": []})]
    _, job = client.post("/api/review", {"path": str(repo)})
    client.wait(job["id"])
    response, payload = client.request("GET", f"/api/jobs/{job['id']}/export?format={fmt}")
    assert response.status == 200
    assert "attachment" in response.getheader("Content-Disposition")
    assert marker in payload.decode("utf-8")


def test_review_input_validation(client, repo):
    for body, message in [
        ({"path": str(repo), "mode": "base"}, "base"),
        ({"path": str(repo), "mode": "paths"}, "fichier"),
        ({"path": str(repo), "mode": "pr"}, "numéro"),
        ({"path": str(repo), "mode": "inconnu"}, "mode"),
        ({"path": str(repo), "effort": "extreme"}, "effort"),
        ({"path": str(repo), "max_cost": "beaucoup"}, "max_cost"),
        ({"mode": "auto"}, "projet"),
    ]:
        status, data = client.post("/api/review", body)
        assert status == 400 and message in data["error"], body


def test_failed_analysis_reports_a_clear_error(client, fake_api, repo):
    status, job = client.post("/api/review", {"path": str(repo), "mode": "base", "base": "absente"})
    assert status == 202
    detail = client.wait(job["id"])
    assert detail["status"] == "failed"
    assert "git" in detail["error"]


def test_pull_request_review_publishes_only_on_request(
    client, fake_api, fake_github, monkeypatch, tmp_path
):
    monkeypatch.setenv("GITHUB_API_URL", fake_github.url)
    client.post("/api/secrets", {"github_token": "gh-session"})
    fake_github.diff = PR_DIFF
    fake_github.files = {"calc.py": "def add(a, b):\n    # calcul\n    return a - b\n"}
    fake_api.replies = [final({"summary": "Bug", "findings": [FINDING]})]

    status, job = client.post("/api/review", {"mode": "pr", "pr": "7", "repo": fake_github.repo})
    assert status == 202
    detail = client.wait(job["id"])
    assert detail["status"] == "done" and detail["can_post"] is True
    assert fake_github.reviews == []
    assert set(fake_github.authorization) == {"Bearer gh-session"}

    status, posted = client.post(f"/api/jobs/{job['id']}/post")
    assert status == 200
    assert posted["result"]["posted_url"] == "https://github.test/review/1"
    assert fake_github.reviews[0]["event"] == "COMMENT"

    status, _ = client.post(f"/api/jobs/{job['id']}/post")
    assert status == 409
    assert len(fake_github.reviews) == 1
    assert "gh-session" not in json.dumps(fake_api.requests)


# --- Nettoyage


def test_clean_end_to_end_then_discard(client, fake_api, repo):
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    status, job = client.post("/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py"})
    assert status == 202
    detail = client.wait(job["id"])
    result = detail["result"]
    assert result["status"] == "committed"
    assert "-import os" in result["diff"]
    assert "import os" in (repo / "app.py").read_text("utf-8")
    branch = result["branch"]
    assert branch in run_git(repo, "branch", "--list", "codeguard/*")

    status, data = client.post(f"/api/jobs/{job['id']}/discard")
    assert status == 200 and data["discarded"] is True
    assert run_git(repo, "branch", "--list", "codeguard/*").strip() == ""
    status, _ = client.post(f"/api/jobs/{job['id']}/push")
    assert status == 400


def test_checks_only_run_when_requested(client, fake_api, repo):
    (repo / ".codeguard.toml").write_text(
        '[codeguard]\nchecks = ["commande-qui-n-existe-pas"]\n', "utf-8"
    )
    run_git(repo, "add", ".codeguard.toml")
    run_git(repo, "commit", "--quiet", "-m", "config")
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    _, job = client.post("/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py"})
    assert client.wait(job["id"])["result"]["status"] == "committed"

    _, job = client.post(
        "/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py", "run_checks": True}
    )
    assert client.wait(job["id"])["result"]["status"] == "baseline_failed"


def test_dry_run_keeps_nothing(client, fake_api, repo):
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]
    _, job = client.post(
        "/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py", "dry_run": True}
    )
    detail = client.wait(job["id"])
    assert detail["result"]["status"] == "dry_run"
    assert run_git(repo, "branch", "--list", "codeguard/*").strip() == ""
    status, _ = client.post(f"/api/jobs/{job['id']}/push")
    assert status == 400


def test_push_and_open_pr_only_on_request(
    client, fake_api, fake_github, repo, tmp_path, monkeypatch
):
    remote = tmp_path / "remote.git"
    run_git(tmp_path, "init", "--bare", "--quiet", str(remote))
    run_git(repo, "remote", "add", "origin", "https://github.com/acme/app.git")
    run_git(repo, "remote", "set-url", "--push", "origin", str(remote))
    monkeypatch.setenv("GITHUB_API_URL", fake_github.url)
    fake_api.replies = [REMOVE_IMPORT, final(CLEAN_OK)]

    _, job = client.post("/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py"})
    detail = client.wait(job["id"])
    assert detail["github_repo"] == "acme/app"
    branch = detail["result"]["branch"]
    assert run_git(remote, "branch", "--list", "codeguard/*").strip() == ""

    status, pushed = client.post(f"/api/jobs/{job['id']}/push", {"open_pr": False})
    assert status == 200 and pushed["pushed"] is True
    assert branch in run_git(remote, "branch", "--list", "codeguard/*")
    assert fake_github.created_prs == []

    status, opened = client.post(f"/api/jobs/{job['id']}/push", {"open_pr": True})
    assert status == 200 and opened["pull_request_url"] == "https://github.test/pull/8"
    assert fake_github.created_prs[0]["head"] == branch

    status, data = client.post(f"/api/jobs/{job['id']}/discard")
    assert status == 400 and "poussée" in data["error"]


# --- Exécution


def test_only_one_analysis_at_a_time_and_cancel_cleans_up(client, fake_api, repo):
    started = threading.Event()
    release = threading.Event()

    def responder(_request):
        started.set()
        release.wait(10)
        return REMOVE_IMPORT

    fake_api.responder = responder
    _, job = client.post("/api/clean", {"path": str(repo), "mode": "paths", "paths": "app.py"})
    assert started.wait(10)

    status, data = client.post("/api/review", {"path": str(repo)})
    assert status == 409 and "en cours" in data["error"]

    status, summary = client.post(f"/api/jobs/{job['id']}/cancel")
    assert status == 200 and summary["cancel_requested"] is True
    release.set()

    detail = client.wait(job["id"])
    assert detail["status"] == "cancelled"
    assert detail["result"] is None
    assert run_git(repo, "branch", "--list", "codeguard/*").strip() == ""
    assert "codeguard" not in run_git(repo, "worktree", "list")
    assert "import os" in (repo / "app.py").read_text("utf-8")

    fake_api.responder = None
    fake_api.replies = [final({"summary": "ok", "findings": []})]
    (repo / "x.py").write_text("x = 1\n", "utf-8")
    status, _ = client.post("/api/review", {"path": str(repo)})
    assert status == 202


def test_unknown_routes_and_jobs(client):
    assert client.get("/api/jobs/abc123")[0] == 404
    assert client.post("/api/jobs/abc123/cancel")[0] == 404
    assert client.get("/api/inconnu")[0] == 404


def test_frontend_does_not_shadow_browser_globals():
    # A top-level `function location()` is a SyntaxError that stops the whole script.
    script = (STATIC_DIR / "app.js").read_text("utf-8")
    declared = re.findall(r"^(?:async )?(?:function|const|let|class) (\w+)", script, re.MULTILINE)
    reserved = {"location", "document", "window", "top", "parent", "self", "history", "origin"}
    assert declared and not reserved & set(declared)


def test_budget_field_accepts_any_amount():
    # With min=0.1 and step=0.5, the browser rejected the default of 5 and blocked the form.
    page = (STATIC_DIR / "index.html").read_text("utf-8")
    assert re.search(r'id="input-cost"[^>]*step="any"', page)


def test_ui_command_starts_and_prints_a_working_link(tmp_path):
    process = subprocess.Popen(
        [sys.executable, "-m", "codeguard", "ui", "--no-browser", "--port", "0"],
        cwd=tmp_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
    )
    try:
        line = process.stdout.readline()
        match = re.search(r"http://127\.0\.0\.1:(\d+)/\?token=(\S+)", line)
        assert match, line
        connection = http.client.HTTPConnection("127.0.0.1", int(match.group(1)), timeout=10)
        connection.request("GET", f"/?token={match.group(2)}")
        assert connection.getresponse().status == 303
        connection.close()
    finally:
        process.terminate()
        process.communicate(timeout=10)


def test_static_assets_are_packaged():
    for name in ("index.html", "app.js", "style.css"):
        assert (Path(STATIC_DIR) / name).is_file()
