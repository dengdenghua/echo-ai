from __future__ import annotations

import asyncio
import threading
from typing import Any

import httpx
import pytest

from runtime.platform.models.model_provider_plugin import ModelProviderPluginManager
from runtime.sensing.gateway.capability_router import create_capability_router
from runtime.sensing.gateway.model_catalog_refresh import (
    DEFAULT_INTERVAL_SECONDS,
    ModelCatalogRefreshLoop,
)


class _Credentials:
    """Minimal credential store stub: the key lives outside the entry."""

    def __init__(self, values: dict[str, dict[str, str]] | None = None) -> None:
        self.values = values if values is not None else {"opencode-zen": {"api_key": "zen-secret"}}

    def get_secret(self, connector_id: str, key: str) -> str | None:
        return self.values.get(connector_id, {}).get(key)

    def list_secrets(self, connector_id: str) -> list[str]:
        return list(self.values.get(connector_id, {}))


def _item() -> dict[str, Any]:
    return {
        "id": "opencode-zen",
        "name_zh": "OpenCode",
        "model_provider": {
            "entry_id": "opencode-zen",
            "display_name": "OpenCode",
            "display_name_zh": "OpenCode",
            "base_url": "https://opencode.ai/zen/v1",
            "models_endpoint": "https://opencode.ai/zen/v1/models",
            "price_provider": "opencode",
            "free_models": [],
            "excluded_models": [],
            "discover_all_models": True,
            "models_are_free": False,
            "compat_profile": "opencode_zen",
        },
    }


class _Registry:
    """Only ``list()`` is needed: the loop resolves descriptors from it."""

    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items = items

    def list(self) -> list[dict[str, Any]]:
        return [dict(item) for item in self.items]


def _manager(state: dict[str, dict[str, Any]]) -> ModelProviderPluginManager:
    return ModelProviderPluginManager(
        custom_models=state,
        lock=threading.RLock(),
        save=lambda *_ids: None,
        unregister_entry=lambda *_args, **_kwargs: True,
        rebuild_routes=lambda: {key: {"ok": True} for key in state},
        credential_store=_Credentials(),
    )


class _Response:
    def __init__(self, ids: list[str]) -> None:
        self._ids = ids

    @staticmethod
    def raise_for_status() -> None:
        return None

    def json(self) -> dict[str, Any]:
        return {"data": [{"id": model} for model in self._ids]}


def _refresh_loop(router: Any) -> ModelCatalogRefreshLoop:
    """Pull the loop the router registered, proving the wiring exists."""

    for handler in router.on_startup:
        loop = getattr(handler, "__self__", None)
        if isinstance(loop, ModelCatalogRefreshLoop):
            return loop
    raise AssertionError("capability router registered no model catalog refresh loop")


def test_refresh_pass_adopts_a_model_published_after_connect(monkeypatch) -> None:
    state: dict[str, dict[str, Any]] = {}
    manager = _manager(state)
    item = _item()
    manager.configure(item, models=["big-pickle", "mimo-v2.5-free"])
    assert "mimo-v2.6-flash-free" not in state["opencode-zen"]["models"]

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_args, **_kwargs: _Response(
            ["big-pickle", "mimo-v2.5-free", "mimo-v2.6-flash-free"]
        ),
    )
    router = create_capability_router(
        registry=_Registry([item]),
        model_provider_plugins=manager,
    )

    refreshed = asyncio.run(_refresh_loop(router).run_once())

    assert refreshed == 1
    entry = state["opencode-zen"]
    assert entry["models"] == ["big-pickle", "mimo-v2.5-free", "mimo-v2.6-flash-free"]
    # The vendored price snapshot predates the release; the provider's own
    # ``-free`` suffix is what keeps a brand-new free model badged free.
    assert entry["model_free_status"]["mimo-v2.6-flash-free"] is True


def test_refresh_pass_keeps_the_catalog_when_upstream_fails(monkeypatch) -> None:
    state: dict[str, dict[str, Any]] = {}
    manager = _manager(state)
    item = _item()
    manager.configure(item, models=["big-pickle"])
    before = dict(state["opencode-zen"])

    def _boom(*_args: Any, **_kwargs: Any) -> Any:
        raise httpx.ConnectError("upstream down")

    monkeypatch.setattr(httpx, "get", _boom)
    router = create_capability_router(
        registry=_Registry([item]),
        model_provider_plugins=manager,
    )

    assert asyncio.run(_refresh_loop(router).run_once()) == 0
    assert state["opencode-zen"] == before


def test_refresh_pass_ignores_connectors_that_are_no_longer_available() -> None:
    state: dict[str, dict[str, Any]] = {}
    manager = _manager(state)
    manager.configure(_item(), models=["big-pickle"])

    router = create_capability_router(
        registry=_Registry([]),
        model_provider_plugins=manager,
    )

    assert asyncio.run(_refresh_loop(router).run_once()) == 0
    assert state["opencode-zen"]["models"] == ["big-pickle"]


def test_zero_interval_env_disables_the_loop(monkeypatch) -> None:
    monkeypatch.setenv("ECHO_MODEL_CATALOG_REFRESH_SECONDS", "0")
    loop = ModelCatalogRefreshLoop(lambda: 0)

    assert loop.interval_seconds == 0
    asyncio.run(loop.start())
    assert loop._task is None
    asyncio.run(loop.close())


def test_interval_env_and_default_are_sane(monkeypatch) -> None:
    monkeypatch.delenv("ECHO_MODEL_CATALOG_REFRESH_SECONDS", raising=False)
    assert ModelCatalogRefreshLoop(lambda: 0).interval_seconds == DEFAULT_INTERVAL_SECONDS

    monkeypatch.setenv("ECHO_MODEL_CATALOG_REFRESH_SECONDS", "900")
    assert ModelCatalogRefreshLoop(lambda: 0).interval_seconds == 900

    monkeypatch.setenv("ECHO_MODEL_CATALOG_REFRESH_SECONDS", "not-a-number")
    assert ModelCatalogRefreshLoop(lambda: 0).interval_seconds == DEFAULT_INTERVAL_SECONDS


def test_a_failing_pass_does_not_end_the_loop() -> None:
    calls: list[int] = []

    def refresh() -> int:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("first pass is broken")
        return 1

    async def _exercise() -> None:
        loop = ModelCatalogRefreshLoop(
            refresh,
            interval_seconds=0.01,
            initial_delay_seconds=0,
        )
        await loop.start()
        for _ in range(200):
            if len(calls) >= 2:
                break
            await asyncio.sleep(0.01)
        await loop.close()

    asyncio.run(_exercise())

    assert len(calls) >= 2


def test_loop_cancels_cleanly_on_shutdown() -> None:
    async def _exercise() -> None:
        loop = ModelCatalogRefreshLoop(
            lambda: 1,
            interval_seconds=3600,
            initial_delay_seconds=3600,
        )
        await loop.start()
        assert loop._task is not None
        await loop.close()
        assert loop._task is None

    asyncio.run(_exercise())


@pytest.mark.parametrize("interval", [0, -1])
def test_non_positive_interval_never_schedules(interval: float) -> None:
    started: list[int] = []
    loop = ModelCatalogRefreshLoop(
        lambda: started.append(1) or 1,
        interval_seconds=interval,
    )

    asyncio.run(loop.start())

    assert loop._task is None
    assert started == []
