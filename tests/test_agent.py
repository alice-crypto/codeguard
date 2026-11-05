import pytest

from codeguard.agent import AgentError, AgentRefused, AgentSettings, Usage, run_agent
from codeguard.config import Config
from codeguard.schemas import REVIEW_SCHEMA, ReviewOutput
from codeguard.tools import ToolBox
from codeguard.workspace import LocalWorkspace
from conftest import final, reply, text, tool

EMPTY = {"summary": "ok", "findings": []}


def settings(**kwargs) -> AgentSettings:
    values = {"model": "claude-opus-5-5", "effort": "high", "max_turns": 10, "max_cost_usd": 5.0}
    return AgentSettings(**{**values, **kwargs})


def run(fake_api, repo, editable=None, **kwargs):
    return run_agent(
        fake_api.client(),
        system="system",
        prompt="prompt",
        toolbox=ToolBox(LocalWorkspace(repo, Config(), editable=editable)),
        schema=REVIEW_SCHEMA,
        output_model=ReviewOutput,
        settings=settings(**kwargs),
    )


def test_request_shape(fake_api, repo):
    fake_api.replies = [final(EMPTY)]
    run(fake_api, repo)
    body = fake_api.requests[0]
    assert body["model"] == "claude-opus-5-5"
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"]["effort"] == "high"
    assert body["output_config"]["format"]["schema"] == REVIEW_SCHEMA
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["fallbacks"] == "default"
    assert body["stream"] is True
    assert "tool_choice" not in body
    assert "server-side-fallback-2026-07-01" in fake_api.headers[0]["anthropic-beta"]


def test_no_fallback_on_models_without_it(fake_api, repo):
    fake_api.replies = [final(EMPTY)]
    run(fake_api, repo, model="claude-haiku-5-5")
    assert "fallbacks" not in fake_api.requests[0]


def test_tool_loop_returns_results_and_replays_history(fake_api, repo):
    fake_api.replies = [
        reply(tool("read_file", {"path": "app.py"}), stop="tool_use"),
        final({"summary": "vu", "findings": []}),
    ]
    result = run(fake_api, repo)
    assert result.output.summary == "vu"
    assert result.turns == 2
    assert result.tool_calls == ["read_file"]

    messages = fake_api.requests[1]["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert messages[1]["content"][0]["type"] == "tool_use"
    tool_result = messages[2]["content"][0]
    assert tool_result["tool_use_id"] == "toolu_1"
    assert "def add" in tool_result["content"]
    assert "is_error" not in tool_result


def test_parallel_results_share_one_message(fake_api, repo):
    fake_api.replies = [
        reply(
            tool("read_file", {"path": "app.py"}, "t1"),
            tool("read_file", {"path": "missing.py"}, "t2"),
            stop="tool_use",
        ),
        final(EMPTY),
    ]
    run(fake_api, repo)
    results = fake_api.requests[1]["messages"][2]["content"]
    assert [r["tool_use_id"] for r in results] == ["t1", "t2"]
    assert results[1]["is_error"] is True


def test_refusal_stops_without_running_tools(fake_api, repo):
    fake_api.replies = [
        reply(
            tool("edit_file", {"path": "app.py", "old_text": "add", "new_text": "x"}),
            stop="refusal",
        )
    ]
    before = (repo / "app.py").read_text("utf-8")
    with pytest.raises(AgentRefused):
        run(fake_api, repo, editable={"app.py"})
    assert (repo / "app.py").read_text("utf-8") == before


def test_truncated_tool_call_is_not_executed(fake_api, repo):
    fake_api.replies = [
        reply(
            tool("edit_file", {"path": "app.py", "old_text": "add", "new_text": "x"}),
            stop="max_tokens",
        )
    ]
    before = (repo / "app.py").read_text("utf-8")
    with pytest.raises(AgentError, match="tronquée"):
        run(fake_api, repo, editable={"app.py"})
    assert (repo / "app.py").read_text("utf-8") == before


def test_turn_limit_asks_for_final_answer_and_marks_partial(fake_api, repo):
    fake_api.replies = [
        reply(tool("read_file", {"path": "app.py"}), stop="tool_use"),
        final(EMPTY),
    ]
    result = run(fake_api, repo, max_turns=1)
    assert result.partial
    assert fake_api.requests[1]["tool_choice"] == {"type": "none"}
    assert fake_api.requests[1]["messages"][-1]["content"][-1]["type"] == "text"


def test_budget_limit_asks_for_final_answer(fake_api, repo):
    fake_api.replies = [
        reply(tool("read_file", {"path": "app.py"}), stop="tool_use", input_tokens=2_000_000),
        final(EMPTY),
    ]
    result = run(fake_api, repo, max_cost_usd=1.0)
    assert result.partial
    assert fake_api.requests[1]["tool_choice"] == {"type": "none"}


def test_invalid_final_answer_gets_one_retry(fake_api, repo):
    fake_api.replies = [reply(text("pas du json")), final(EMPTY)]
    assert run(fake_api, repo).output.findings == []
    assert len(fake_api.requests) == 2


def test_repeated_invalid_final_answer_is_an_error(fake_api, repo):
    fake_api.replies = [reply(text("non")), reply(text("toujours non"))]
    with pytest.raises(AgentError, match="invalide"):
        run(fake_api, repo)


def test_cost_estimate():
    usage = Usage(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_write_tokens=1_000_000,
        cache_read_tokens=1_000_000,
    )
    assert usage.cost_usd("claude-opus-5-5") == pytest.approx(4 + 20 + 5 + 0.4)
    assert usage.cost_usd("modele-inconnu") is None
