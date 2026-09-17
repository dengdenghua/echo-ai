from types import SimpleNamespace

from runtime.sensing.gateway._realtime_cerebrum_project_os import (
    _add_project_planning_hooks,
)


def test_native_project_planning_hooks_fall_back_to_stack_planner() -> None:
    router = SimpleNamespace(default_model="router-model")
    stack = SimpleNamespace(planner=SimpleNamespace(router=router, planner_model="planner-model"))
    runtime = SimpleNamespace(_stack=stack, _subagent_runner=lambda task, context: "")
    hooks: dict[str, object] = {}

    _add_project_planning_hooks(runtime, SimpleNamespace(params=None), hooks)

    assert {"generate_milestones", "decompose_tasks", "qa_task"} <= hooks.keys()
    assert hooks["prepare_initiation"].keywords == {"model": "planner-model"}


def test_turn_model_takes_priority_for_project_planning() -> None:
    router = SimpleNamespace(default_model="router-model")
    stack = SimpleNamespace(planner=SimpleNamespace(router=router, planner_model="planner-model"))
    runtime = SimpleNamespace(_stack=stack, _subagent_runner=lambda task, context: "")
    turn = SimpleNamespace(params=SimpleNamespace(model="turn-model"))
    hooks: dict[str, object] = {}

    _add_project_planning_hooks(runtime, turn, hooks)

    assert hooks["prepare_initiation"].keywords == {"model": "turn-model"}
