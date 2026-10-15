"""The dispatcher's self-configured fallback follows Settings → 模型."""

from __future__ import annotations

import pytest

from runtime.platform.models.llm import Message, ModelRequest
from runtime.sensing.model_router.live_fallback import LiveCustomModelFallback


def _request() -> ModelRequest:
    return ModelRequest(model="auto", messages=[Message(role="user", content="hi")])


def test_rebuilds_only_when_the_catalog_changes() -> None:
    built: list[str | None] = []
    stamp = {"value": 1}

    class Fake:
        def __init__(self, name: str) -> None:
            self.default_model = name

    def build(prefer: str | None) -> Fake:
        built.append(prefer)
        return Fake(f"model-{stamp['value']}")

    live = LiveCustomModelFallback("planner", build=build, signature=lambda: stamp["value"])
    assert live.default_model == "model-1"
    assert live.default_model == "model-1"
    assert built == ["planner"]
    stamp["value"] = 2
    assert live.default_model == "model-2"
    assert built == ["planner", "planner"]


def test_a_deleted_model_stops_answering(monkeypatch: pytest.MonkeyPatch) -> None:
    # Before: the fallback was built at startup, so a model deleted in
    # Settings kept answering (with its URL and key) until a restart.
    catalog: dict[str, object] = {
        "stub": {
            "id": "stub",
            "provider": "openai",
            "base_url": "http://127.0.0.1:9/v1",
            "api_key": "sk-test",
            "models": ["stub-chat"],
        }
    }
    monkeypatch.setattr(
        "runtime.sensing.model_router.openai_router._read_custom_models", lambda: dict(catalog)
    )
    stamp = {"value": 1}
    live = LiveCustomModelFallback(None, signature=lambda: stamp["value"])
    assert live.default_model == "stub-chat"

    catalog.clear()
    stamp["value"] = 2
    assert live.default_model is None
    with pytest.raises(RuntimeError, match="no LLM model configured"):
        live.call(_request())
