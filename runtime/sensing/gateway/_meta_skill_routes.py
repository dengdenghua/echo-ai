"""Skill administration routes for the meta router: catalog, toggles, install.

Pure structural split of ``meta_router.create_meta_router`` — no logic
changes. Each ``_register_*`` function attaches its endpoints to the
injected router, reading the factory's injected values and the
``_require_admin`` closure from ``MetaRouterDeps``; the factory still owns the
registration order.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter, HTTPException, Query, Request, Response

    FASTAPI_AVAILABLE = True
except ImportError:  # pragma: no cover
    FASTAPI_AVAILABLE = False
    APIRouter = None  # type: ignore[assignment, misc]
    HTTPException = None  # type: ignore[assignment, misc]
    Query = None  # type: ignore[assignment, misc]
    Request = None  # type: ignore[assignment, misc]
    Response = None  # type: ignore[assignment, misc]

from runtime.sensing.gateway._meta_models import (
    CapabilityPermissionsResponse,
    CapabilityPermissionWire,
    SlashCommandsResponse,
)
from runtime.sensing.gateway._meta_router_deps import MetaRouterDeps
from runtime.sensing.gateway._meta_skill_install import (
    _install_public_skill_dir,
    _require_safe_skill_install_name,
    _uninstall_public_skill_dir,
)


def _register_capability_catalog_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Capability catalog plus skill and skills-market enable / disable."""
    registry = d.registry
    tool_registry = d.tool_registry
    mobile_skills_root = d.mobile_skills_root
    _require_admin = d.require_admin

    @router.get("/api/capability-catalog")
    def api_capability_catalog(
        q: str | None = Query(default=None),
        source: str | None = Query(default=None),
        kind: str | None = Query(default=None),
        risk_level: str | None = Query(default=None),
        permission_group: str | None = Query(default=None),
        available_only: bool = Query(default=False),
        limit: int = Query(default=500, ge=1, le=2000),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        from runtime.execution.misc.capability_catalog import (
            build_capability_catalog,
            filter_capability_entries,
        )

        catalog = build_capability_catalog(
            registry=registry,
            tool_registry=tool_registry,
            mobile_skills_root=mobile_skills_root,
        )
        filtered = filter_capability_entries(
            catalog["capabilities"],
            q=q,
            source=source,
            kind=kind,
            risk_level=risk_level,
            permission_group=permission_group,
            available_only=available_only,
            limit=limit,
            offset=offset,
        )
        filtered["summary"] = catalog["summary"]
        return filtered

    @router.post("/api/skills/{skill_name}/enable")
    def api_enable_skill(request: Request, skill_name: str) -> dict[str, Any]:
        _require_admin(request, purpose="modify skills")
        try:
            registry.enable(skill_name)
        except KeyError as exc:
            raise HTTPException(404, f"skill not found: {skill_name}") from exc
        return {"ok": True, "name": skill_name, "enabled": True}

    @router.post("/api/skills/{skill_name}/disable")
    def api_disable_skill(request: Request, skill_name: str) -> dict[str, Any]:
        _require_admin(request, purpose="modify skills")
        try:
            registry.disable(skill_name)
        except KeyError as exc:
            raise HTTPException(404, f"skill not found: {skill_name}") from exc
        return {"ok": True, "name": skill_name, "enabled": False}

    # ─── Skills-market enable / disable ────────────────────
    #
    #
    @router.post("/api/skills-market/{skill_id}/enable")
    def api_market_enable(request: Request, skill_id: str) -> dict[str, Any]:
        _require_admin(request, purpose="modify skills")
        if not registry.has(skill_id):
            from runtime.execution.suckers.market_skills import (
                load_single_market_skill,
            )

            loaded = load_single_market_skill(registry, skill_id)
            if not loaded:
                raise HTTPException(
                    404,
                    f"skill not found: {skill_id} (no SKILL.md in all_skills/)",
                )
        try:
            registry.enable(skill_id)
        except KeyError as exc:
            raise HTTPException(404, f"skill not found: {skill_id}") from exc
        return {"ok": True, "skill_id": skill_id, "enabled": True}

    @router.post("/api/skills-market/{skill_id}/disable")
    def api_market_disable(request: Request, skill_id: str) -> dict[str, Any]:
        _require_admin(request, purpose="modify skills")
        try:
            registry.disable(skill_id)
        except KeyError as exc:
            raise HTTPException(404, f"skill not found: {skill_id}") from exc
        return {"ok": True, "skill_id": skill_id, "enabled": False}


def _register_skill_install_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Admin-only skill install from a URL archive, and uninstall."""
    _require_admin = d.require_admin

    # ─── Skill install / uninstall ─────────────────────────
    @router.post("/api/skills/install")
    async def api_install_skill(request: Request) -> dict[str, Any]:
        import tempfile

        from runtime.execution.suckers.market_skills import immutable_prompt_catalog_required

        # Auth: this endpoint mutates skills/public which is auto-loaded
        # as Python code on next boot. It's effectively arbitrary-code
        # installation, so we require BOTH:
        #   1. authenticated caller (require_auth=True regardless of
        #      router config)
        #   2. admin role
        _require_admin(request, purpose="install skills")
        if immutable_prompt_catalog_required():
            raise HTTPException(
                403,
                "URL-based prompt installation is disabled in shared/commercial deployments; "
                "ship prompt changes in a reviewed release artifact",
            )

        try:
            body = await request.json()
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise HTTPException(400, f"body: {exc}") from exc
        url = (body or {}).get("url", "")
        if not isinstance(url, str) or not url.startswith("http"):
            raise HTTPException(400, "url required (https://...)")
        name_override = (body or {}).get("name")

        # SSRF guard + DNS-rebinding-proof fetch. ``check_url`` alone
        # would re-resolve on connect; use safe_httpx_get which pins
        # the resolved IP as the connect target while keeping the
        # original host name in the Host header.
        from runtime.safety.auth.url_guard import check_url, safe_httpx_get

        verdict = check_url(url, allow_private=False)
        if not verdict.allow:
            raise HTTPException(400, f"url rejected: {verdict.reason}")

        # Validate the new name *now* before any network I/O so we
        # fail fast on hostile filenames (path traversal in
        # ``skills/public/<name>``).
        if name_override is not None:
            if not isinstance(name_override, str) or not name_override:
                raise HTTPException(400, "name must be a non-empty string")
            try:
                name_override = _require_safe_skill_install_name(name_override, label="name")
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

        # The download + extract + install chain is all blocking
        # (sync httpx, zip extraction, directory copy). Offload it to a
        # worker thread so the event loop isn't frozen for the ~30s
        # network timeout. HTTPException propagates through to_thread.
        def _do_install_blocking() -> dict[str, Any]:
            try:
                import httpx as _httpx
            except ImportError as e:
                raise HTTPException(500, "httpx required for skill install") from e

            # follow_redirects=False on the transport; safe_httpx_get
            # re-validates the next hop through check_url if we ever
            # enable follow_redirects. We keep it off so the network
            # topology of an outbound skill install stays one hop, one
            # check.
            try:
                r = safe_httpx_get(url, timeout=30.0, follow_redirects=False)
                r.raise_for_status()
            except ValueError as exc:
                raise HTTPException(400, f"url rejected: {exc}") from exc
            except (_httpx.HTTPError, ConnectionError, TimeoutError) as exc:
                raise HTTPException(502, f"download failed: {exc}") from exc
            if len(r.content) > 50 * 1024 * 1024:
                raise HTTPException(413, "archive too large (>50MB)")

            with tempfile.TemporaryDirectory() as tmpdir:
                tmp = Path(tmpdir)
                archive = tmp / "skill.zip"
                archive.write_bytes(r.content)
                extract_dir = tmp / "extracted"
                extract_dir.mkdir(parents=True, exist_ok=True)
                # Use the hardened extractor (zip-slip + symlink-component +
                # size caps) instead of ``shutil.unpack_archive`` which has
                # none of those defenses.
                try:
                    from runtime.execution.suckers.hub.installer import (
                        ArchiveSafetyError,
                        safe_extract_zip,
                    )

                    safe_extract_zip(r.content, extract_dir)
                except ArchiveSafetyError as exc:
                    raise HTTPException(400, f"unsafe archive: {exc}") from exc
                except (OSError, ValueError) as exc:
                    raise HTTPException(400, f"unpack failed: {exc}") from exc

                skill_dirs = list(extract_dir.rglob("SKILL.md"))
                if not skill_dirs:
                    raise HTTPException(400, "no SKILL.md found in archive")
                skill_root = skill_dirs[0].parent
                skill_name = name_override or skill_root.name
                try:
                    target = _install_public_skill_dir(skill_root, skill_name)
                    skill_name = target.name
                except FileExistsError as exc:
                    raise HTTPException(409, str(exc)) from exc
                except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
                    raise HTTPException(400, str(exc)) from exc
                except OSError as exc:
                    raise HTTPException(
                        500,
                        f"skill install failed: {type(exc).__name__}: {exc}",
                    ) from exc

            return {"ok": True, "name": skill_name, "path": str(target)}

        return await asyncio.to_thread(_do_install_blocking)

    @router.delete("/api/skills/{skill_name}/uninstall")
    def api_uninstall_skill(request: Request, skill_name: str) -> dict[str, Any]:
        _require_admin(request, purpose="uninstall skills")
        try:
            _uninstall_public_skill_dir(skill_name)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except FileExistsError as exc:
            raise HTTPException(409, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, f"skill directory not found: {skill_name}") from exc
        except NotADirectoryError as exc:
            raise HTTPException(400, f"not a directory: {skill_name}") from exc
        except OSError as exc:
            raise HTTPException(
                500,
                f"skill uninstall failed: {type(exc).__name__}: {exc}",
            ) from exc
        return {"ok": True, "name": skill_name, "removed": True}


def _register_capability_permission_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Capability permission groups and the slash-command catalog."""
    registry = d.registry
    _require_admin = d.require_admin

    @router.get(
        "/api/capability-permissions",
        response_model=CapabilityPermissionsResponse,
    )
    def api_capability_permissions() -> dict[str, Any]:
        from runtime.execution.misc.capability_permissions import (
            list_capability_permissions,
        )

        return {
            "permissions": list_capability_permissions(
                registered_skill_names=set(registry.all_names()),
            ),
        }

    @router.put(
        "/api/capability-permissions/{group}",
        response_model=CapabilityPermissionWire,
    )
    def api_capability_permission_update(
        request: Request,
        group: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        _require_admin(request, purpose="modify capability permissions")
        from runtime.execution.misc.capability_permissions import (
            list_capability_permissions,
            set_capability_group_enabled,
        )

        try:
            set_capability_group_enabled(group, bool(body.get("enabled")))
        except KeyError as exc:
            raise HTTPException(404, f"unknown capability group: {group}") from exc
        updated = list_capability_permissions(
            registered_skill_names=set(registry.all_names()),
        )
        return next(item for item in updated if item["id"] == group)

    # ─── Slash commands ─────────────────────────────────────

    @router.get(
        "/api/slash-commands",
        response_model=SlashCommandsResponse,
    )
    def api_slash_commands() -> dict[str, Any]:
        """Return the merged slash-command catalog (global ∪ project).

        Frontend `/` typeahead uses this to show the user what
        commands are available. Body is intentionally NOT sent — it
        can be long and the client doesn't need to render it until
        expansion time (server-side, via the run endpoint).
        """
        import os

        from runtime.execution.slash_commands import load_slash_commands

        project_dir = os.getcwd()
        try:
            cmds = load_slash_commands(project_dir=project_dir)
        except (OSError, KeyError, ValueError):
            cmds = []
        return {"commands": [c.as_dict() for c in cmds]}
