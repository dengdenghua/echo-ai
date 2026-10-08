"""Unified-diff parsing / reverse-apply helpers for the filesystem router.

The implementation now lives in :mod:`runtime.protocol.diff_parser`: it is
shared with the turn-scoped file-edit journal
(``runtime.core.cerebrum.file_edit_journal``), which must not import a gateway
module from core.  This module keeps the historical private names as aliases --
``fs_router`` re-exports them and ``_fs_router_endpoints`` imports them by name.
"""

from __future__ import annotations

from runtime.protocol.diff_parser import (
    DiffApplyConflict,
    DiffFormatError,
    ParsedDiffHunk,
    parse_unified_hunks,
    reverse_unified_diff,
)

_DiffFormatError = DiffFormatError
_DiffApplyConflict = DiffApplyConflict
_ParsedDiffHunk = ParsedDiffHunk
_parse_unified_diff = parse_unified_hunks
_reverse_unified_diff = reverse_unified_diff

__all__ = [
    "_DiffApplyConflict",
    "_DiffFormatError",
    "_ParsedDiffHunk",
    "_parse_unified_diff",
    "_reverse_unified_diff",
]
