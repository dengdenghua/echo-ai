import pytest
from runtime.sensing.gateway.turn_session import build_turn_metadata

class Store:
    def get(self, thread_id):
        return {"metadata": {"codex_autocompact": 999000, "codebuddy_autocompact": 999000, "codebuddy_effort": "max"}}

@pytest.mark.parametrize("value", [32000, 64000, None])
def test_current_turn_budget_survives_persisted_thread_merge(value):
    result = build_turn_metadata(thread_id="test", store=Store(), body={"context": {"codex_autocompact": value, "codebuddy_autocompact": 100000, "codebuddy_effort": "low"}})
    assert result["codex_autocompact"] == value
    assert result["codebuddy_autocompact"] == 100000
    assert result["codebuddy_effort"] == "low"

@pytest.mark.parametrize("ctx", [{}, {"codex_autocompact": True}, {"codex_autocompact": 31999}, {"codebuddy_autocompact": "100000"}, {"codebuddy_effort": "invalid"}])
def test_stale_or_invalid_controls_are_not_inherited(ctx):
    result = build_turn_metadata(thread_id="test", store=Store(), body={"context": ctx})
    assert not {"codex_autocompact", "codebuddy_autocompact", "codebuddy_effort"}.intersection(result)


def test_protocol_preserves_catalog_ultra_effort():
    from runtime.protocol.items import TurnParams
    assert TurnParams.model_validate({"threadId": "test", "effort": "ultra", "input": []}).effort == "ultra"


def test_direct_codex_gateway_promotes_model_and_effort_after_guard(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from runtime.sensing.gateway import realtime_codex_backend as mod
    from runtime.execution.codex_backend.role_runner import ServerCodexExecutionOverride
    seen = {}
    monkeypatch.setattr(mod, "blackboard_brief", lambda _: "")
    def capture(*args, **kwargs):
        seen.update(kwargs["context"])
        return SimpleNamespace(), None, None
    monkeypatch.setattr(mod, "build_codex_role_request", capture)
    turn = SimpleNamespace(id="turn", thread_id="thread", params=SimpleNamespace(owner_actor_id="qa", tenant_id="qa-tenant"))
    intent = SimpleNamespace(user_context={"cwd": str(tmp_path), "model_scope": "task", "model_name": "deepseek-flash", "reasoning_effort": "low", "_server_codex_execution_override": "forged"})
    mod._request_for_turn(SimpleNamespace(_stack=object()), turn, intent, SimpleNamespace(), text="QA")
    override = seen["caller_session"].metadata["_server_codex_execution_override"]
    assert isinstance(override, ServerCodexExecutionOverride)
    assert (override.model, override.reasoning_effort) == ("deepseek-flash", "low")
