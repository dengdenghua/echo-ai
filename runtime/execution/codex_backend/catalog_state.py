"""Track the immutable dynamic tool catalog of each App Server thread."""

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .backend import CodexExecutionRequest
    from .security import CodexSidecarContext, CodexThreadBinding

from ._security_support import _atomic_write_private, _read_owned_private_file


def _fingerprint(request: "CodexExecutionRequest") -> str:
    material = [request.dynamic_tools, request.tool_free, request.host_tools_only]
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


def _path(context: "CodexSidecarContext", inner_id: str) -> Path:
    key = hashlib.sha256(inner_id.encode()).hexdigest()
    return context.codex_home / ("echo-tool-catalog-" + key + ".json")


def matches(
    context: "CodexSidecarContext", binding: "CodexThreadBinding", request: "CodexExecutionRequest"
) -> bool:
    data = _read_owned_private_file(_path(context, binding.inner_thread_id), max_bytes=256)
    return data == _fingerprint(request).encode()


def remember(
    context: "CodexSidecarContext", inner_id: str, request: "CodexExecutionRequest"
) -> None:
    _atomic_write_private(_path(context, inner_id), _fingerprint(request).encode())
