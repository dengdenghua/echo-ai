"""How a project looks in lists: the icon id and category it was created with.

Both are display metadata picked in the 新建项目 dialog. They are stored in the
project's JSON document, so projects written before they existed simply load
with ``None`` — no schema migration is involved.

The icon is an id drawn by the frontend as a line icon (``folder``,
``trending-up``, …), never an emoji or a URL. The category is a short label;
the dialog sends preset ids (``investment``, ``travel``, …).
"""

from __future__ import annotations

import re
import unicodedata

PROJECT_ICON_PATTERN = r"^[a-z0-9_-]{1,32}$"
PROJECT_CATEGORY_MAX_LENGTH = 64

_ICON_RE = re.compile(PROJECT_ICON_PATTERN)


def normalize_project_icon(raw: object) -> str | None:
    """The stored icon id, or ``None`` for anything that is not a valid id."""
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    return value if _ICON_RE.fullmatch(value) else None


def normalize_project_category(raw: object) -> str | None:
    """The category with whitespace collapsed, or ``None`` when unusable.

    Empty, overlong and control-character values are dropped rather than
    truncated: a cut-off label is worse than no label.
    """
    if not isinstance(raw, str):
        return None
    value = " ".join(raw.split())
    if not value or len(value) > PROJECT_CATEGORY_MAX_LENGTH:
        return None
    if any(unicodedata.category(char).startswith("C") for char in value):
        return None
    return value
