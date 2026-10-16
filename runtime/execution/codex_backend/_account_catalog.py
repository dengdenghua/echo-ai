"""Codex account catalogs: models, quota, usage, connectors and marketplace plugins."""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from pathlib import Path

from runtime.safety.auth.scope import TenantScope

from ._account_plugins import _legacy_plugin_catalog_response, _normalize_plugin_catalog
from ._account_wire import (
    _normalize_app_entry,
    _normalize_model_entry,
    _normalize_rate_limits,
    _normalize_usage,
)
from .types import ConfigurationError, ProtocolError

# Same logger name as before the split, so log routing is unchanged.
_LOG = logging.getLogger("runtime.execution.codex_backend.account")


class CodexAccountCatalogMixin:
    """Read-mostly catalog calls served through a principal's control runtime."""

    async def list_models(
        self,
        scope: TenantScope | None,
        *,
        include_hidden: bool = False,
    ) -> list[dict[str, object]]:
        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            cached = runtime.model_catalog_cache.get(include_hidden)
            if cached is not None:
                runtime.last_used = time.monotonic()
                return [dict(model) for model in cached[1]]
            cursor: str | None = None
            models: list[dict[str, object]] = []
            for _page in range(20):
                response = await runtime.client.list_models(
                    include_hidden=include_hidden,
                    cursor=cursor,
                    limit=100,
                )
                raw_models = response.get("data")
                assert isinstance(raw_models, list)
                for raw_model in raw_models:
                    if isinstance(raw_model, Mapping):
                        models.append(_normalize_model_entry(raw_model))
                raw_cursor = response.get("nextCursor")
                cursor = raw_cursor if isinstance(raw_cursor, str) and raw_cursor else None
                if cursor is None:
                    break
            else:
                raise ProtocolError("model/list exceeded the bounded pagination limit")
            runtime.last_used = time.monotonic()
            runtime.model_catalog_cache[include_hidden] = (
                runtime.last_used,
                [dict(model) for model in models],
            )
            return models

    async def read_rate_limits(
        self,
        scope: TenantScope | None,
    ) -> dict[str, object]:
        """Return a bounded, display-safe view of ChatGPT quota windows."""

        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            response = await runtime.client.read_account_rate_limits()
            runtime.last_used = time.monotonic()
            return _normalize_rate_limits(response)

    async def read_usage(
        self,
        scope: TenantScope | None,
    ) -> dict[str, object]:
        """Return account token activity without exposing auth metadata."""

        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            response = await runtime.client.read_account_usage()
            runtime.last_used = time.monotonic()
            return _normalize_usage(response)

    async def list_apps(
        self,
        scope: TenantScope | None,
        *,
        force_refetch: bool = False,
    ) -> list[dict[str, object]]:
        """List account-accessible connectors with bounded public metadata."""

        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            cursor: str | None = None
            apps: list[dict[str, object]] = []
            for _page in range(20):
                response = await runtime.client.list_apps(
                    cursor=cursor,
                    limit=100,
                    force_refetch=force_refetch and cursor is None,
                )
                raw_apps = response.get("data")
                assert isinstance(raw_apps, list)
                apps.extend(
                    _normalize_app_entry(item) for item in raw_apps if isinstance(item, Mapping)
                )
                raw_cursor = response.get("nextCursor")
                cursor = raw_cursor if isinstance(raw_cursor, str) and raw_cursor else None
                if cursor is None:
                    break
            else:
                raise ProtocolError("app/list exceeded the bounded pagination limit")
            runtime.last_used = time.monotonic()
            return apps

    async def list_plugins(
        self,
        scope: TenantScope | None,
        *,
        force_refetch: bool = False,
    ) -> list[dict[str, object]]:
        """List Codex marketplace plugins as Echo capability rows."""

        runtime = await self._runtime(scope)
        async with runtime.lock:
            await self._drain_notifications(runtime)
            if not force_refetch and runtime.plugin_catalog_cache is not None:
                runtime.last_used = time.monotonic()
                return [dict(item) for item in runtime.plugin_catalog_cache[1]]
            try:
                response = await runtime.client.list_plugins(
                    force_refetch=force_refetch,
                    marketplace_kinds=(
                        "local",
                        "vertical",
                        "workspace-directory",
                        "shared-with-me",
                        "created-by-me-remote",
                    ),
                )
            except Exception as exc:
                # The official remote catalog is independently rate limited.  A local
                # desktop user may safely fall back to their already-downloaded Codex
                # marketplace checkout; authenticated/shared principals must never
                # inherit that OS-user cache.
                if scope is not None or self._legacy_source_home is None:
                    raise
                response = _legacy_plugin_catalog_response(
                    self._legacy_source_home,
                    install_home=runtime.home,
                )
                _LOG.warning(
                    "Codex remote plugin catalog unavailable; using local official cache: %s",
                    exc,
                )
            rows = _normalize_plugin_catalog(response)
            if scope is None and self._legacy_source_home is not None:
                # App Server may return a successful but partial response while the
                # remote marketplace is throttled. Merge the local official checkout
                # as a stale-while-revalidate source; live rows win on matching ids so
                # their current install/auth state is preserved.
                try:
                    cached_rows = _normalize_plugin_catalog(
                        _legacy_plugin_catalog_response(
                            self._legacy_source_home,
                            install_home=runtime.home,
                        )
                    )
                except (ConfigurationError, ProtocolError):
                    cached_rows = []
                live_ids = {str(item.get("id") or "") for item in rows}
                rows.extend(item for item in cached_rows if item.get("id") not in live_ids)
            runtime.last_used = time.monotonic()
            runtime.plugin_catalog_cache = (runtime.last_used, [dict(item) for item in rows])
            return rows

    async def plugin_icon_path(
        self,
        scope: TenantScope | None,
        *,
        catalog_id: str,
    ) -> Path | None:
        """Resolve a catalog icon without exposing marketplace filesystem paths."""

        entry = await self._plugin_catalog_entry(scope, catalog_id)
        raw_path = entry.get("_icon_path")
        if not isinstance(raw_path, str) or not raw_path:
            return None
        path = Path(raw_path).resolve(strict=False)
        if scope is not None or self._legacy_source_home is None:
            return None
        try:
            path.relative_to(self._legacy_source_home)
        except ValueError:
            return None
        return path if path.is_file() else None

    async def install_plugin(
        self,
        scope: TenantScope | None,
        *,
        catalog_id: str,
        install_attempt_id: str | None = None,
    ) -> dict[str, object]:
        """Install one catalog row through the principal-scoped App Server."""

        entry = await self._plugin_catalog_entry(scope, catalog_id)
        runtime = await self._runtime(scope)
        async with runtime.lock:
            response = await runtime.client.install_plugin(
                str(entry["plugin_name"]),
                marketplace_path=(
                    str(entry["_marketplace_path"])
                    if isinstance(entry.get("_marketplace_path"), str)
                    else None
                ),
                remote_marketplace_name=(
                    str(entry["remote_marketplace_name"])
                    if isinstance(entry.get("remote_marketplace_name"), str)
                    else None
                ),
                install_attempt_id=install_attempt_id,
            )
            runtime.plugin_catalog_cache = None
            runtime.last_used = time.monotonic()
        apps = response.get("appsNeedingAuth")
        return {
            "installed": True,
            "enabled": True,
            "capability_id": catalog_id,
            "source": "codex_plugin",
            "auth_policy": response.get("authPolicy"),
            "apps_needing_auth": apps if isinstance(apps, list) else [],
            "message": "Codex 插件已按需安装。",
        }

    async def uninstall_plugin(
        self,
        scope: TenantScope | None,
        *,
        catalog_id: str,
    ) -> dict[str, object]:
        """Uninstall one catalog row through the principal-scoped App Server."""

        entry = await self._plugin_catalog_entry(scope, catalog_id)
        plugin_id = entry.get("codex_plugin_id")
        if not isinstance(plugin_id, str) or not plugin_id:
            raise ProtocolError("plugin catalog row is missing its Codex plugin id")
        runtime = await self._runtime(scope)
        async with runtime.lock:
            await runtime.client.uninstall_plugin(plugin_id)
            runtime.plugin_catalog_cache = None
            runtime.last_used = time.monotonic()
        return {"installed": False, "capability_id": catalog_id}

    async def _plugin_catalog_entry(
        self,
        scope: TenantScope | None,
        catalog_id: str,
    ) -> dict[str, object]:
        if not isinstance(catalog_id, str) or not catalog_id.startswith("codex-marketplace:"):
            raise ConfigurationError("Codex plugin catalog id is invalid")
        rows = await self.list_plugins(scope)
        match = next((item for item in rows if item.get("id") == catalog_id), None)
        if match is None:
            rows = await self.list_plugins(scope, force_refetch=True)
            match = next((item for item in rows if item.get("id") == catalog_id), None)
        if match is None:
            raise ConfigurationError("Codex marketplace plugin was not found")
        return match
