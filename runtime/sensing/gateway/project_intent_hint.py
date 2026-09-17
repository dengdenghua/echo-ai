"""Server-side project-intent detection, so every entry point gets the hint.

``detectProjectIntent`` lives in the web composer, which means the hint only
appears while someone types in the app. A message arriving from Slack, WeCom,
Feishu, email or any of the other channel adapters never touches that component,
so a room where someone says "开一个智能床笠项目" over IM gets no suggestion at
all — the one place a durable project is most likely to be proposed informally.

Detecting it here covers every entry point. The behaviour deliberately matches
the composer's: **suggest, never route**. Project OS creates reviewed
milestones, budgets and team state, so entering it stays an explicit act
(``/project run``). This module only produces a hint the surface can show.

The patterns mirror ``frontend/src/core/threads/project-intent.ts`` field for
field. Two copies of a regex drift, so ``tests/test_project_intent_hint.py``
reads the TypeScript source and asserts the two stay identical rather than
trusting that whoever edits one remembers the other.
"""

from __future__ import annotations

import re

# Keep these literals byte-identical to the TypeScript source; the consistency
# test compares them textually, not semantically.
_PROJECT_INTENT_PATTERN_SOURCES: tuple[str, ...] = (
    r"(?:创建|新建|发起|启动|开启|开一个|开个|立项|规划)[^。！？，,;；]{0,30}?项目",
    r"(?:start|create|launch|kick off|set up|plan|scope)[^.!?,;]{0,40}?\bproject\b",
)

_PROJECT_INTENT_PATTERNS = (
    re.compile(_PROJECT_INTENT_PATTERN_SOURCES[0]),
    re.compile(_PROJECT_INTENT_PATTERN_SOURCES[1], re.IGNORECASE),
)

# The composer truncates before matching so a long paste cannot make the scan
# unbounded; same bound here.
_SCAN_LIMIT = 400


def detect_project_intent(text: str) -> str | None:
    """Return the normalized text when it reads like proposing a new project.

    ``None`` means no hint. An explicit ``/project`` command is already inside
    Project OS, so it never produces a suggestion to enter it.
    """

    body = str(text or "").strip()
    if not body:
        return None
    if body.startswith("/project"):
        return None
    normalized = re.sub(r"\s+", " ", body)[:_SCAN_LIMIT]
    if any(pattern.search(normalized) for pattern in _PROJECT_INTENT_PATTERNS):
        return normalized
    return None
