"""The self-configured dispatch fallback, kept in step with Settings → 模型.

The dispatcher's fallback answers every request no named route claims, such
as Auto turns. It used to be built once, at startup, from
``custom_models.json``. A model the user then deleted kept answering, with
its old URL and key, until the backend restarted; a first model added later
never became the fallback. This router rebuilds it whenever that file
changes.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from typing import Any

from runtime.platform.models.llm import ModelRequest, ModelResponse, ModelRouter


def _catalog_signature() -> tuple[int, int] | None:
    try:
        from runtime.platform.process.paths import app_paths

        stat = app_paths().custom_models_path.stat()
    except (OSError, ImportError):
        return None
    return (stat.st_mtime_ns, stat.st_size)


def _build(prefer: str | None) -> ModelRouter:
    from runtime.sensing.model_router.models import UnconfiguredModelRouter
    from runtime.sensing.model_router.openai_router import (
        build_fallback_router_from_custom_models,
    )

    return build_fallback_router_from_custom_models(prefer) or UnconfiguredModelRouter()


class LiveCustomModelFallback(ModelRouter):
    """``build_fallback_router_from_custom_models`` that follows the catalog."""

    provider_name = "custom"

    def __init__(
        self,
        prefer: str | None = None,
        *,
        build: Callable[[str | None], ModelRouter] = _build,
        signature: Callable[[], object] = _catalog_signature,
    ) -> None:
        self._prefer = prefer
        self._build = build
        self._signature = signature
        self._lock = threading.Lock()
        self._seen: object = object()
        self._router: ModelRouter | None = None

    def current(self) -> ModelRouter:
        seen = self._signature()
        with self._lock:
            if self._router is None or seen != self._seen:
                self._router = self._build(self._prefer)
                self._seen = seen
            return self._router

    @property
    def default_model(self) -> str | None:
        return getattr(self.current(), "default_model", None)

    def __getattr__(self, name: str) -> Any:
        # Capability probes (``supports_*``, ``base_url`` …) read the live
        # router, as they read the static one before.
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self.current(), name)

    def call(self, request: ModelRequest) -> ModelResponse:
        return self.current().call(request)

    def call_stream(self, request: ModelRequest) -> Iterator[Any]:
        yield from self.current().call_stream(request)
