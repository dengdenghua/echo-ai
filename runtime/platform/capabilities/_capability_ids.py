"""Normalize capability names to stable identifiers."""

import re

_SLUG_RE = re.compile(r"[^a-z0-9_-]+", re.I)


def _slug(value: str) -> str:
    return _SLUG_RE.sub("-", value.strip()).strip("-").lower()
