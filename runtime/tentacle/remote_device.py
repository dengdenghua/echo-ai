"""A desktop or VM whose tools really execute on its authenticated client."""

from __future__ import annotations

from typing import Any

from .base import TentacleType, ToolCall, ToolResult
from .mobile.device import MobileDevice


class RemoteDesktopDevice(MobileDevice):
    """Reuse transport/lifecycle, without inheriting Android capabilities."""

    def __init__(self, *, capabilities: list[str], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.tentacle_type = TentacleType.DESKTOP
        self.platform = self.meta["platform"]
        self._capabilities = list(capabilities)

    @property
    def capabilities(self) -> list[str]:
        return list(self._capabilities)

    async def execute(self, call: ToolCall) -> ToolResult:
        if self._ws_server is None:
            return ToolResult.fail(call.call_id, -32011, "Remote desktop transport unavailable", 0)
        if call.tentacle_id != self.tentacle_id:
            return ToolResult.fail(call.call_id, -32004, "Device target mismatch", 0)
        return await super().execute(call)
