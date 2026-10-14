"""Receipt and admission boundary for direct Project OS model calls."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from runtime.projectos.governance import record_usage


@dataclass(frozen=True)
class StandingModelBoundary:
    store: Any
    project_id: str
    ensure_admitted: Callable[[], None]


_BOUNDARY: ContextVar[StandingModelBoundary | None] = ContextVar(
    "standing_model_boundary", default=None
)


@contextmanager
def standing_model_boundary(boundary: StandingModelBoundary) -> Iterator[None]:
    token = _BOUNDARY.set(boundary)
    try:
        yield
    finally:
        _BOUNDARY.reset(token)


def project_model_call(router: Any, request: Any) -> Any:
    boundary = _BOUNDARY.get()
    if boundary is None:
        return router.call(request)
    boundary.ensure_admitted()
    root_id = f"standing-model:{uuid4().hex}"
    response = None
    try:
        response = router.call(request)
        return response  # noqa: RET504 — finally records this exact response
    finally:
        cost = getattr(response, "cost", None)
        # A default zero is not a cost receipt. Providers must have explicitly
        # supplied USD, including an explicit zero for a free call.
        reported = cost is not None and "usd" in getattr(cost, "model_fields_set", ())
        record_usage(
            boundary.store,
            boundary.project_id,
            {
                "governance": {"root_id": root_id, "cost_usd": cost.usd if reported else None},
            },
        )
