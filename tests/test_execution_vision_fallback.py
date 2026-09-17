"""Image admission must preserve project/team scheduling before any effects."""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from runtime.execution.engines import EngineId, EngineSelectionError, ExecutionPhase
from runtime.platform.config.schema import AgentConfig
from runtime.platform.models import ParsedIntent
from runtime.protocol import Turn, TurnParams
from runtime.sensing.gateway.realtime_execution import select_turn_execution


@pytest.mark.parametrize("requested", ["auto", "opencode"])
@pytest.mark.parametrize(
    ("signals", "expected_driver"),
    [
        ({}, "react"),
        ({"project_command": True}, "project_os"),
        ({"group_fanout": True}, "group_fanout"),
        ({"topology_id": "design-team"}, "swarm_mesh"),
        ({"coordinated": True}, "react"),
        (
            {"project_command": True, "group_fanout": True, "topology_id": "design-team"},
            "project_os",
        ),
    ],
)
def test_image_admission_preserves_host_dispatch(monkeypatch, requested, signals, expected_driver):
    probe = Mock(side_effect=AssertionError("capability admission must precede engine readiness"))
    monkeypatch.setattr("runtime.execution.opencode_backend.inspect_readiness", probe)
    turn = Turn(
        threadId="image-task",
        params=TurnParams(threadId="image-task", executionEngine=requested),
    )
    intent = ParsedIntent(
        raw="Review the attached design",
        normalized_goal="Review the attached design",
        intent_type="task",
        modalities=["image"],
    )
    options = dict(
        project_command=False,
        group_fanout=False,
        topology_id=None,
        codex_partner=False,
        reflection_fast_path=False,
    )
    options.update(signals)
    request = select_turn_execution(
        SimpleNamespace(_stack=SimpleNamespace(config=AgentConfig())),
        turn,
        object(),
        intent,
        **options,
    )
    if requested == "opencode":
        with pytest.raises(EngineSelectionError) as raised:
            asyncio.run(request)
        assert raised.value.unmet == ("vision",)
    else:
        route = asyncio.run(request)
        assert route.engine is EngineId.ECHO
        assert route.driver_for(ExecutionPhase.PRIMARY) == expected_driver
        assert route.driver_for(ExecutionPhase.REPAIR) == "react"
        assert route.reason == "capability_unmet:vision"
    probe.assert_not_called()
    assert turn.execution is None
