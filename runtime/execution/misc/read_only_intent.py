"""Text normalization for inferring workspace read-only intent, never grants."""
from __future__ import annotations

import re

_PERMISSION_CONSTRAINT = re.compile(
    r"(^|[，,。；;\n])\s*(?:请\s*)?"
    r"(?:(?:不要|严禁|禁止|不得|不可|不允许|不)\s*"
    r"(?:修改|改动|更改|更新|调整)\s*(?:访问权限|权限设置|权限|审批模式)|"
    r"(?:do\s+not|don't|must\s+not|never)\s+"
    r"(?:modify|change|edit|update|adjust)\s+(?:the\s+)?"
    r"(?:access\s+permissions|permissions|approval\s+mode))"
    r"(?=\s*(?:[，,。；;!！?？\n]|\.(?=\s|$)|$))",
    re.IGNORECASE,
)


def workspace_read_only_text(value: str | None) -> str:
    """Keep permission-preservation clauses out of global read-only inference.

    'Click the test editor; do not change permissions' authorizes input while
    preserving the access policy. It is not 'do not modify any file'. Only an
    entire, precisely scoped clause is removed from this classifier's copy;
    the original user request and all permission/approval checks remain intact.
    """
    return _PERMISSION_CONSTRAINT.sub(lambda match: match.group(1), str(value or "")).lower()
