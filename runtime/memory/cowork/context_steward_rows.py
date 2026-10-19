"""Split out of :mod:`context_steward` so that module stays under the 1000-line
god-file ratchet. Everything here is re-exported by the original module, so
import sites do not move.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

_CONTEXT_MODES = frozenset({"isolated", "selective", "fork"})
_SPACE_RE = re.compile(r"\s+")
_LATIN_TERM_RE = re.compile(r"[a-z0-9][a-z0-9_+.#/-]{1,}", re.IGNORECASE)
_CJK_RUN_RE = re.compile(r"[\u3400-\u9fff]{2,}")
_STOP_TERMS = {
    "一个",
    "这个",
    "那个",
    "我们",
    "你们",
    "他们",
    "可以",
    "需要",
    "进行",
    "以及",
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "agent",
}


@dataclass(frozen=True)
class _HistoryRow:
    fingerprint: tuple[str, str]
    role: str
    text: str
    order: int
    source_id: str
    kind: str = "conversation"

    def render(self) -> str:
        label = (
            "用户"
            if self.role in {"user", "human"}
            else "项目"
            if self.role == "project"
            else "摘要"
            if self.role == "summary"
            else "成员"
        )
        return f"{label}: {self.text}"


def _source_id(role: str, text: str) -> str:
    digest = hashlib.sha256(f"{role}\0{text}".encode()).hexdigest()[:16]
    return f"ctx_{digest}"


def _durable_kind(key: str) -> str:
    lowered = str(key or "").lower()
    for kind, hints in _DURABLE_KIND_HINTS:
        if any(hint in lowered for hint in hints):
            return kind
    return "fact"


def _message_text(message: Any) -> tuple[str, str]:
    if isinstance(message, str):
        return "unknown", _SPACE_RE.sub(" ", message).strip()
    if not isinstance(message, dict):
        return "unknown", _SPACE_RE.sub(" ", str(message or "")).strip()
    role = str(message.get("role") or message.get("type") or "unknown").lower()
    content = message.get("content")
    if content is None:
        content = message.get("text") or message.get("body") or ""
    if isinstance(content, list):
        content = " ".join(
            str(part.get("text") or part.get("content") or "")
            for part in content
            if isinstance(part, dict)
        )
    return role, _SPACE_RE.sub(" ", str(content or "")).strip()


def _history_rows(messages: list[Any], current_message: str) -> list[_HistoryRow]:
    current = _SPACE_RE.sub(" ", str(current_message or "")).strip()
    rows: list[_HistoryRow] = []
    # Scan the complete authorised history. The final prompt remains bounded by
    # token budget, while old topic matches and decisions stay discoverable in
    # long-running projects instead of disappearing behind a recent-turn cap.
    for order, message in enumerate(messages):
        role, text = _message_text(message)
        if not text or (role in {"user", "human"} and text == current):
            continue
        # A single persisted message may be huge (tool output / pasted file).
        # Retrieval operates on a bounded preview; source data stays untouched.
        preview = text[:900].rstrip()
        rows.append(
            _HistoryRow(
                fingerprint=(role, preview),
                role=role,
                text=preview,
                order=order,
                source_id=_source_id(role, preview),
                kind=_durable_kind(preview),
            )
        )
    return rows


def _durable_rows(durable_context: dict[str, Any] | None) -> list[_HistoryRow]:
    """Turn the group's durable blackboard into compact project-memory rows."""

    if not isinstance(durable_context, dict):
        return []
    rows: list[_HistoryRow] = []
    for order, key in enumerate(sorted(durable_context)):
        value = durable_context[key]
        text = _SPACE_RE.sub(" ", f"{key}: {value}").strip()[:1200].rstrip()
        if not text:
            continue
        rows.append(
            _HistoryRow(
                fingerprint=("project", text),
                role="project",
                text=text,
                order=order,
                source_id=_source_id("project", text),
                kind=_durable_kind(str(key)),
            )
        )
    return rows


def _terms(text: str) -> set[str]:
    lowered = str(text or "").lower()
    terms = {term for term in _LATIN_TERM_RE.findall(lowered) if term not in _STOP_TERMS}
    for run in _CJK_RUN_RE.findall(lowered):
        # Bigrams make Chinese descriptions and messages comparable without an
        # external segmenter.  Cap each run so pasted prose cannot dominate.
        bounded = run[:80]
        terms.update(bounded[i : i + 2] for i in range(max(0, len(bounded) - 1)))
    return {term for term in terms if term and term not in _STOP_TERMS}


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = len(re.findall(r"[\u3400-\u9fff]", text))
    other = max(0, len(text) - cjk)
    # Conservative mixed-language approximation: one CJK glyph is roughly a
    # token, while Latin prose averages close to four characters per token.
    return int(cjk + math.ceil(other / 4))


def _fit_rows(
    rows: list[tuple[float, _HistoryRow]],
    token_budget: int,
    *,
    selection_engine: CoworkContextSelectionEngine | None = None,
    selection_audit: dict[str, Any] | None = None,
    section: str = "",
    member: dict[str, Any] | None = None,
    message: str = "",
    session_id: str = "",
    turn_id: str = "",
) -> tuple[str, int, set[tuple[str, str]], tuple[str, ...]]:
    chosen: list[_HistoryRow] = []
    used = 0
    seen: set[tuple[str, str]] = set()
    ordered_pairs: list[tuple[float, _HistoryRow]] = []
    candidate_seen: set[tuple[str, str]] = set()
    for score, row in sorted(rows, key=lambda item: (-item[0], -item[1].order)):
        if row.fingerprint in candidate_seen:
            continue
        candidate_seen.add(row.fingerprint)
        ordered_pairs.append((score, row))
    if selection_engine is not None and ordered_pairs and token_budget > 0:
        if selection_audit is not None:
            selection_audit["calls"] = int(selection_audit.get("calls") or 0) + 1
        candidates = tuple(
            CoworkContextCandidate(
                source_id=row.source_id,
                content=row.render(),
                estimated_tokens=_estimate_tokens(row.render()),
                score=score,
                order=row.order,
                kind=row.kind,
            )
            for score, row in ordered_pairs
        )
        try:
            engine_kwargs: dict[str, Any] = {
                "section": section,
                "member": dict(member) if isinstance(member, dict) else None,
                "message": message,
                "candidates": candidates,
                "budget_tokens": token_budget,
            }
            if bool(getattr(selection_engine, "_echo_lifecycle_host", False)):
                engine_kwargs.update(session_id=session_id, turn_id=turn_id)
            selected = selection_engine.select_context(
                **engine_kwargs,
            )
            if isinstance(selected, (str, bytes)) or not isinstance(selected, Sequence):
                raise TypeError("context selection engine must return a sequence of source ids")
            by_id = {row.source_id: (score, row) for score, row in ordered_pairs}
            selected_pairs: list[tuple[float, _HistoryRow]] = []
            selected_ids: set[str] = set()
            rejected = 0
            output_limit = max(64, len(by_id) * 2)
            for output_index, raw_id in enumerate(selected):
                if output_index >= output_limit:
                    rejected += 1
                    break
                source_id = str(raw_id or "").strip()
                pair = by_id.get(source_id)
                if pair is None:
                    rejected += 1
                    continue
                if source_id in selected_ids:
                    continue
                selected_ids.add(source_id)
                selected_pairs.append(pair)
            ordered_pairs = selected_pairs
            if selection_audit is not None:
                selection_audit["rejected_ids"] = (
                    int(selection_audit.get("rejected_ids") or 0) + rejected
                )
        except Exception as exc:  # noqa: BLE001 - deterministic safe fallback
            if selection_audit is not None:
                selection_audit["fallbacks"] = int(selection_audit.get("fallbacks") or 0) + 1
                selection_audit.setdefault("fallback_reasons", []).append(type(exc).__name__)
    for _score, row in ordered_pairs:
        if row.fingerprint in seen:
            continue
        rendered = row.render()
        cost = _estimate_tokens(rendered) + (1 if chosen else 0)
        if cost > token_budget - used:
            continue
        chosen.append(row)
        seen.add(row.fingerprint)
        used += cost
    chosen.sort(key=lambda row: row.order)
    text = "\n".join(row.render() for row in chosen)
    return (
        text,
        _estimate_tokens(text),
        {row.fingerprint for row in chosen},
        tuple(row.source_id for row in chosen),
    )


def _member_profile_text(member: dict[str, Any]) -> str:
    affinity = member.get("affinity")
    if isinstance(affinity, (list, tuple, set)):
        affinity_text = " ".join(str(item) for item in affinity)
    else:
        affinity_text = str(affinity or "")
    return " ".join(
        str(value or "")
        for value in (
            member.get("name") or member.get("agent_id"),
            member.get("display_name"),
            member.get("description"),
            affinity_text,
        )
    )


def _context_mode(member: dict[str, Any]) -> str:
    mode = str(member.get("context_mode") or "selective").strip().lower()
    return mode if mode in _CONTEXT_MODES else "selective"


def _render_authorized_rows(
    rows: list[_HistoryRow],
) -> tuple[str, int, tuple[str, ...]]:
    ordered: list[_HistoryRow] = []
    seen: set[tuple[str, str]] = set()
    for row in sorted(rows, key=lambda item: item.order):
        if row.fingerprint in seen:
            continue
        seen.add(row.fingerprint)
        ordered.append(row)
    text = "\n".join(row.render() for row in ordered)
    return text, _estimate_tokens(text), tuple(row.source_id for row in ordered)


def _adaptive_budgets(
    history_message_count: int,
    durable_source_count: int,
) -> tuple[str, int, int, int]:
    """Scale the working set without confusing it with total project memory."""

    if history_message_count > 120 or durable_source_count > 24:
        return "long_project", 1000, 800, 600
    if history_message_count > 24 or durable_source_count:
        return "ongoing_project", 700, 500, 400
    return "short_chat", 420, 280, 0


_DURABLE_KIND_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("objective", ("objective", "goal", "目标", "目的")),
    ("constraint", ("constraint", "requirement", "policy", "限制", "约束", "要求")),
    ("decision", ("decision", "conclusion", "决定", "决策", "结论")),
    ("risk", ("risk", "blocker", "blocked", "风险", "阻塞")),
    ("artifact", ("artifact", "file", "output", "document", "产物", "文件", "文档")),
    ("task", ("task", "todo", "status", "next", "任务", "待办", "状态", "下一步")),
)


@dataclass(frozen=True)
class CoworkContextCandidate:
    """One already-authorized fact exposed to a selection plugin."""

    source_id: str
    content: str
    estimated_tokens: int
    score: float
    order: int
    kind: str


class CoworkContextSelectionEngine(Protocol):
    """Safe plugin seam for replacing relevance/order decisions.

    Engines return source ids, never prompt text. The steward resolves those
    ids against its already-authorized candidate set and reapplies the hard
    token budget, so a plugin cannot widen visibility or inject content.
    """

    name: str

    def select_context(
        self,
        *,
        section: str,
        member: dict[str, Any] | None,
        message: str,
        candidates: tuple[CoworkContextCandidate, ...],
        budget_tokens: int,
    ) -> Sequence[str]: ...
