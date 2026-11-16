"""Desktop capture intent shared by turn routing and tool catalog activation."""

import re

_CAPTURE_ACTION = re.compile(
    r"\bscreen_(?:capture|info)\b|"
    r"(?:截取|捕获)[^。！？!?；;\n]{0,20}(?:屏幕|桌面|窗口)|"
    r"(?:请|帮我|给我)[^。！？!?；;\n]{0,8}(?:截图|截屏|截个图|截一张图)|"
    r"^(?:截图|截屏)[。！.!]?$|"
    r"\b(?:take|capture)\b[^.!?;\n]{0,24}\b(?:screenshot|screen|desktop|window)\b",
    re.IGNORECASE,
)


def desktop_capture_requested(text: str) -> bool:
    """Detect an action request, not a generic mention such as 截图是什么.

    This is a routing signal, never a grant; caller policy still handles
    global no-tool directives, tool allowlists and per-call approval.
    """
    return bool(_CAPTURE_ACTION.search(str(text or "")))
