import pytest

from runtime.execution.opencode_events import reported_turn_cost


def message(id, cost, parent="current"):
    return {"info": {"id": id, "role": "assistant", "parentID": parent, "cost": cost}}


def test_turn_cost_includes_tool_rounds_but_not_history_or_repeated_final():
    messages = [
        message("old", 10, "previous"),
        message("tool", 0.2),
        message("final", 0.3),
        message("final", 0.3),
    ]
    assert reported_turn_cost(messages, "current") == pytest.approx(0.5)


@pytest.mark.parametrize("cost", [None, True, -1, float("nan"), float("inf"), "0"])
def test_missing_or_invalid_cost_remains_unknown(cost):
    assert reported_turn_cost([message("tool", 0.2), message("final", cost)], "current") is None


def test_explicit_zero_is_valid_but_no_receipt_is_unknown():
    assert reported_turn_cost([message("free", 0)], "current") == 0
    assert reported_turn_cost([], "current") is None
