"""Explicit in-memory state shared by the phases of a single realtime turn."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from runtime.protocol import Turn, TurnParams
from runtime.sensing.gateway.realtime_gateway import EventEmitter

if TYPE_CHECKING:
    from runtime.sensing.gateway.realtime_cerebrum import CerebrumRuntime


@dataclass
class _TurnContext:
    runtime: CerebrumRuntime
    params: dict[str, Any]
    emitter: EventEmitter
    validated: TurnParams
    thread_id: str
    text: str
    _auto_wake: bool
    requested_model_before_routing: Any
    log: Any = field(init=False)
    turn: Turn = field(init=False)
    apply_delivery_context: Any = field(init=False)
    delivery: Any = field(init=False)
    turn_created_at: float = field(init=False)
    intent: Any = field(init=False)
    emitter_registered_at: float = field(init=False)
    active_turn_registered_at: float = field(init=False)
    turn_started_visible_at: float = field(init=False)
    session_reference_frame: str | None = field(init=False)
    user_item: Any = field(init=False)
    user_message_visible_at: float = field(init=False)
    conversation_messages: list[dict[str, Any]] = field(init=False)
    explicit_project_command: bool = field(init=False)
    provider: Any = field(init=False)
    agent: Any = field(init=False)
    turn_driver: str = field(init=False)
    topology_id: Any = field(init=False)
    _team_pattern_execution: str = field(init=False)
    execution: Any = field(init=False)
