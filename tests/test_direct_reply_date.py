"""Echo's direct reply path knows today's date, as its calendar questions need."""

from __future__ import annotations

from datetime import datetime

from runtime.platform.models import ParsedIntent
from runtime.sensing.gateway.openai_gateway.context_manager import _build_messages_for_llm


def test_today_is_the_last_system_message_before_the_conversation() -> None:
    intent = ParsedIntent(raw="今天星期几", intent_type="chitchat", normalized_goal="今天星期几")

    messages = _build_messages_for_llm(intent, None)

    system = [m for m in messages if m.role == "system"]
    assert system[-1].content == f"当前日期: {datetime.now().strftime('%Y-%m-%d %A')}。"
    assert messages[len(system)].role == "user"
    assert messages[-1].content == "今天星期几"
