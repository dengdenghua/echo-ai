"""
ask_user_question · pause-and-ask skill.

Today the model has ``request_approval`` (yes/no on a tool call). For
broader product decisions ("PostgreSQL or SQLite?", "Vite or Webpack?")
we need a structured-choice question.

This skill emits a ``user_question`` record on the active session's
event emitter. The frontend picks it up and renders a card with the
question + clickable options. When the user replies (whether by
clicking an option or sending a custom "Other" answer), the reply
flows back into the next turn as a normal user message; the model
sees the response and continues.

This implementation is intentionally lightweight: it does NOT block
the current ReAct loop waiting on a future. Mid-turn synchronous
blocking would require an ``ApprovalProvider`` instance in
``session.metadata`` (similar to ``request_approval``), which is a
larger refactor. The marker-based variant matches the
"queued steering" pattern the realtime gateway already supports.

Future enhancement: when the session does carry an
``ApprovalProvider`` (e.g. via a metadata key the runtime sets at
turn start), upgrade to a true mid-turn block.
"""

from __future__ import annotations

from typing import Any

from .registry import Skill, SkillRegistry


def _ask_user_question(
    question: str = "",
    options: list[str] | None = None,
    allow_other: bool = True,
    questions: list[dict[str, Any]] | None = None,
    **_kw: Any,
) -> dict[str, Any]:
    """Pause and ask the user a structured multiple-choice question.

    The model emits this when it needs a product decision the user is
    in the best position to make. The UI renders a card with the
    listed options; the user's reply becomes the next user message.

    Returns a structured ack so the model knows the question was
    posted (not the answer — that arrives as the next user turn).
    """
    if questions is not None:
        if not isinstance(questions, list) or not 1 <= len(questions) <= 3:
            return {"ok": False, "error": "questions must contain 1..3 questions"}
        cleaned_questions = []
        for index, item in enumerate(questions):
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("title"), str)
                or not item["title"].strip()
            ):
                return {"ok": False, "error": "each question requires a title"}
            choices = item.get("options", [])
            if (
                not isinstance(choices, list)
                or len(choices) > 6
                or len(choices) == 1
                or any(not isinstance(x, str) or not x.strip() for x in choices)
            ):
                return {
                    "ok": False,
                    "error": "options must be empty for free text or contain 2..6 strings",
                }
            cleaned_questions.append(
                {
                    "id": f"question_{index + 1}",
                    "title": item["title"].strip(),
                    "options": [x.strip() for x in choices],
                    "multiple": item.get("multiple") is True,
                }
            )
        return {
            "ok": True,
            "type": "clarification_questionnaire",
            "title": "完善需求",
            "questions": cleaned_questions,
            "yield_turn": True,
            "instructions": "The result is a user questionnaire. End the turn; never answer it for the user or treat it as project approval.",
        }
    if not isinstance(question, str) or not question.strip():
        return {
            "ok": False,
            "error": "question must be a non-empty string",
            "error_type": "invalid_argument",
        }
    if options is None:
        return {
            "ok": False,
            "error": "options must be a list of 2..6 strings",
            "error_type": "invalid_argument",
        }
    if not isinstance(options, list):
        return {
            "ok": False,
            "error": "options must be a list",
            "error_type": "invalid_argument",
        }
    cleaned: list[str] = []
    for opt in options:
        if not isinstance(opt, str):
            continue
        s = opt.strip()
        if s:
            cleaned.append(s)
    if not (2 <= len(cleaned) <= 6):
        return {
            "ok": False,
            "error": (f"options must contain 2..6 non-empty strings (got {len(cleaned)} valid)"),
            "error_type": "invalid_argument",
        }

    # Best-effort: emit a structured event on the active session
    # emitter so the frontend can render a question card. Falls back
    # silently when no emitter is wired (test / headless mode).
    posted = False
    try:
        from runtime.platform.process.session import current_session

        session = current_session()
        if session is not None:
            emitter = (session.metadata or {}).get("event_emitter")
            if callable(emitter):
                emitter(
                    {
                        "type": "user_question",
                        "question": question.strip(),
                        "options": cleaned,
                        "allow_other": bool(allow_other),
                    }
                )
                posted = True
    except Exception:  # noqa: BLE001 — best-effort emit must not fail the skill
        posted = False

    return {
        "ok": True,
        "posted": posted,
        "question": question.strip(),
        "options": cleaned,
        "allow_other": bool(allow_other),
        # Signal to the model that it should yield this turn — the
        # reply will arrive as the next user message.
        "yield_turn": True,
        "instructions": (
            "Question posted to the user. End this turn with a brief "
            "Final Answer that names the question and lists the "
            "options; the user's reply will be the next message."
        ),
    }


def register_ask_user_question_skill(registry: SkillRegistry) -> int:
    """Register the ask_user_question skill. Returns 1."""
    registry.register(
        Skill(
            name="ask_user_question",
            description=(
                "用途: 收集用户才能决定的需求、偏好或产品选择，以可点击问卷展示，不要一次列出多个纯文本问题。"
                "只问尚未提供且影响下一步的信息，首轮最多3题；已明确的需求直接推进。"
                "questions 参数为对象数组，每项包含 title、options（2-6个字符串；自由输入用空数组）、multiple（可选布尔）。"
                "用户可补充文字或表示未确定。问卷不代表批准立项、拉人或执行操作；调用后结束本轮等待用户回答。"
                "兼容单题参数 question、options、allow_other。"
            ),
            affinity=["interaction", "ui", "ask_user"],
            cost_profile="low",
            trusted_source="skill://public/ask_user_question",
            handler=_ask_user_question,
            tests=[],
        )
    )
    return 1


__all__ = [
    "_ask_user_question",
    "register_ask_user_question_skill",
]
