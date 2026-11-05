"""Boucle d'agent sur l'API Messages, avec plafonds de tours et de coût."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from codeguard.tools import ToolBox

MAX_TOKENS = 64_000
MAX_INVALID_STREAMS = 3

# USD per million tokens: (input, output). Cache writes cost 1.25x input, reads 0.1x input.
PRICES = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
# Models that accept the server-side `fallbacks: "default"` parameter.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


class AgentError(Exception):
    pass


class AgentRefused(AgentError):
    pass


@dataclass
class AgentSettings:
    model: str
    effort: str
    max_turns: int
    max_cost_usd: float


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0

    def add(self, usage) -> None:
        self.input_tokens += usage.input_tokens or 0
        self.output_tokens += usage.output_tokens or 0
        self.cache_write_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0

    def cost_usd(self, model: str) -> float | None:
        """Estimate at the requested model's rates; None for a model not in the table."""
        prices = PRICES.get(model)
        if prices is None:
            return None
        input_price, output_price = prices
        return (
            self.input_tokens * input_price
            + self.output_tokens * output_price
            + self.cache_write_tokens * input_price * 1.25
            + self.cache_read_tokens * input_price * 0.1
        ) / 1_000_000


@dataclass
class AgentResult:
    output: BaseModel
    usage: Usage
    turns: int
    partial: bool = False
    tool_calls: list[str] = field(default_factory=list)


def _request(client, settings: AgentSettings, kwargs: dict):
    """Stream one response. A tool input the SDK cannot parse raises ValueError with no
    tool_use block to answer, so the only recovery is to send the request again."""
    for attempt in range(MAX_INVALID_STREAMS):
        try:
            with client.beta.messages.stream(**kwargs) as stream:
                return stream.get_final_message()
        except ValueError:
            if attempt == MAX_INVALID_STREAMS - 1:
                raise AgentError("réponse du modèle illisible après plusieurs essais") from None
    raise AssertionError("unreachable")


def run_agent(
    client,
    *,
    system: str,
    prompt: str,
    toolbox: ToolBox,
    schema: dict,
    output_model: type[BaseModel],
    settings: AgentSettings,
    log: Callable[[str], None] = lambda _message: None,
) -> AgentResult:
    # Proxies may reject this field, so it stays off when a custom base URL is set.
    eager = not os.environ.get("ANTHROPIC_BASE_URL")
    request: dict = {
        "model": settings.model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "tools": toolbox.definitions(eager=eager),
        "thinking": {"type": "adaptive"},
        "output_config": {
            "effort": settings.effort,
            "format": {"type": "json_schema", "schema": schema},
        },
        "cache_control": {"type": "ephemeral"},
    }
    if settings.model in FALLBACK_MODELS:
        request["betas"] = [FALLBACK_BETA]
        request["fallbacks"] = "default"

    messages: list[dict] = [{"role": "user", "content": prompt}]
    usage = Usage()
    tool_calls: list[str] = []
    finishing = False
    invalid_outputs = 0
    turn = 0
    hard_limit = settings.max_turns + 3

    while True:
        turn += 1
        if turn > hard_limit:
            raise AgentError(f"aucune réponse finale après {hard_limit} tours")
        kwargs = {**request, "messages": messages}
        if finishing:
            kwargs["tool_choice"] = {"type": "none"}
        response = _request(client, settings, kwargs)
        usage.add(response.usage)
        cost = usage.cost_usd(settings.model)
        cost_note = f", ~{cost:.2f} $" if cost is not None else ""
        log(f"tour {turn} : {response.stop_reason}{cost_note}")
        served_by = getattr(response, "model", settings.model)
        if served_by != settings.model:
            log(f"réponse servie par {served_by} (coût estimé au tarif de {settings.model})")

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None)
            raise AgentRefused(f"le modèle a refusé la demande (catégorie : {category})")
        if response.stop_reason == "max_tokens":
            # A truncated tool input can still parse as valid: never run it.
            raise AgentError(f"réponse tronquée à {MAX_TOKENS} jetons")

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "pause_turn":
            continue

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if tool_uses:
            results: list[dict] = []
            for block in tool_uses:
                log(f"  {block.name} {_short(block.input)}")
                tool_calls.append(block.name)
                content, is_error = toolbox.execute(block.name, block.input)
                result = {"type": "tool_result", "tool_use_id": block.id, "content": content}
                if is_error:
                    result["is_error"] = True
                results.append(result)
            over_budget = cost is not None and cost >= settings.max_cost_usd
            if not finishing and (turn >= settings.max_turns or over_budget):
                finishing = True
                reason = "budget" if over_budget else "nombre de tours"
                log(f"limite atteinte ({reason}) : demande de la réponse finale")
                results.append(
                    {
                        "type": "text",
                        "text": "The session limit is reached and tools are now disabled. Give "
                        "your final structured answer from what you have established so far.",
                    }
                )
            messages.append({"role": "user", "content": results})
            continue

        text = "".join(block.text for block in response.content if block.type == "text")
        try:
            output = output_model.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as exc:
            invalid_outputs += 1
            if invalid_outputs >= 2:
                raise AgentError(f"réponse finale invalide : {exc}") from exc
            messages.append(
                {
                    "role": "user",
                    "content": "Your final answer did not match the required JSON schema. "
                    "Send it again in the required format.",
                }
            )
            continue
        return AgentResult(
            output=output,
            usage=usage,
            turns=turn,
            partial=finishing,
            tool_calls=tool_calls,
        )


def _short(raw_input: object) -> str:
    if not isinstance(raw_input, dict):
        return ""
    for key in ("path", "pattern"):
        if raw_input.get(key):
            return str(raw_input[key])[:100]
    return ""
