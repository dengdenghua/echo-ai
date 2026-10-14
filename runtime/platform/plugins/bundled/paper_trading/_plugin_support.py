"""Module-level helpers for the paper_trading plugin.

Moved verbatim out of ``paper_trading/__init__.py`` (which re-imports them)
when ``PaperTradingPlugin.register_routes`` was split into route groups, so
that file stays within its line budget.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from . import PaperTradingPlugin


def _explicitly_enabled(config: dict[str, Any], key: str) -> bool:
    """Accept only a real boolean ``true`` for security-sensitive switches."""
    return config.get(key) is True


def _enabled_by_default(config: dict[str, Any], key: str) -> bool:
    """Default to enabled while still rejecting false and string booleans."""
    return config.get(key, True) is True


def _quote_code(value: str) -> str:
    """Validate one A-share code and add the exchange suffix used upstream."""

    clean = str(value or "").strip().lower()
    if not clean:
        return ""
    if "." in clean:
        code, suffix = clean.rsplit(".", 1)
        if re.fullmatch(r"\d{6}", code) and suffix in {"sh", "sz", "bj"}:
            return f"{code}.{suffix}"
        return ""
    if not re.fullmatch(r"\d{6}", clean):
        return ""
    if clean.startswith(("4", "8", "92")):
        suffix = "bj"
    elif clean.startswith(("5", "6", "9")):
        suffix = "sh"
    else:
        suffix = "sz"
    return f"{clean}.{suffix}"


def _quote_codes(value: str, *, limit: int, required: bool = False) -> list[str]:
    raw = [part.strip() for part in str(value or "").split(",") if part.strip()]
    normalized: list[str] = []
    seen: set[str] = set()
    for item in raw:
        code = _quote_code(item)
        if not code:
            raise ValueError(f"无效股票代码: {item}")
        if code not in seen:
            normalized.append(code)
            seen.add(code)
    if required and not normalized:
        raise ValueError("至少需要一个股票代码")
    if len(normalized) > limit:
        raise ValueError(f"每个连接最多订阅 {limit} 只股票")
    return normalized


class _LazyLivePushEventClient:
    """Create the credentialed upstream only when a real subscriber arrives."""

    def __init__(self, owner: PaperTradingPlugin) -> None:
        self._owner = owner

    def subscribe(self, event: str, params: list[str], callback: Any) -> None:
        push = self._owner._push_client()
        if push is None:
            raise RuntimeError("平台实时行情源尚未配置可信 HTTPS 或登录凭证")
        push.subscribe(event, params, callback)

    def unsubscribe(self, event: str, callback: Any) -> None:
        # Never call _push_client() during teardown: doing so could create a
        # fresh authenticated socket while the plugin is unloading.
        push = self._owner.push
        if push is not None:
            push.unsubscribe(event, callback)
