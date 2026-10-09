"""
Meta router · feedback / skills / auth-provider listing.

Extracted from the monolithic ``runtime/platform/ui/app.py`` in the
app.py-split campaign. Houses the "reflective" endpoints that don't
belong to any one feature — feedback on replies, the registered
skill catalog the UI browses, and the list of configured login
methods.

Endpoints
---------

    POST /api/feedback          · record 👍/👎 on a reply
    GET  /api/feedback          · admin read-back with limit + filter
    GET  /api/skills            · registered skill catalog
    GET  /api/auth/providers    · login methods available to the UI

Design notes
------------

* **Stateless factory injection.** All per-app state (skill registry,
  feedback-log path, auth configs, identity store) flows in via
  ``create_meta_router`` kwargs. The function itself owns nothing
  beyond the local closures, matching the pattern in
  ``config_router.py``.
* **Actor resolution stays lazy.** The feedback handler wants an
  optional actor tag. Rather than bind the auth stack at factory
  time, we import ``_resolve_actor`` inside the handler — keeps this
  module light and lets the big openai_gateway module import without
  a circular.

Structural split
----------------

The support code was extracted into sibling ``_``-prefixed submodules
in the god-file split campaign; this module keeps the ``create_meta_router``
closure factory (which must stay here so the ``meta_router._dynamic_plugin_skill_names``
binding the tests monkeypatch stays the one the factory resolves):

* ``_meta_models.py``        · Pydantic response models
* ``_meta_skill_install.py`` · skills/public install + uninstall helpers
* ``_meta_skill_metadata.py``· skill-market classification + catalog parse
* ``_meta_mentions.py``      · @-mention autocomplete builder
* ``_meta_router_deps.py``   · injected values shared by the route groups
* ``_meta_skill_routes.py``  · capability catalog, skill toggles, install, permissions
* ``_meta_auth_routes.py``   · auth status, strict /api/auth/me + logout, providers
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from contextlib import suppress
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

from runtime.sensing._fastapi_guard import require_fastapi
from runtime.sensing.gateway._meta_auth_routes import _register_auth_routes
from runtime.sensing.gateway._meta_mentions import _build_mentions_autocomplete
from runtime.sensing.gateway._meta_models import (
    FeedbackListResponse,
    FeedbackPostResponse,
    SkillsResponse,
)
from runtime.sensing.gateway._meta_router_deps import MetaRouterDeps
from runtime.sensing.gateway._meta_skill_metadata import (
    SKILL_CATEGORIES,
    _default_skill_library_dir,
    _derive_skill_category,
    _dynamic_plugin_skill_names,
    _is_hidden_skill_catalog_entry,
    _load_file_skill_catalog,
    _permission_group_for_skill,
    _resolve_thread_active_agents,
    _skill_group_for,
    _skill_kind,
    _skill_market_profile,
)
from runtime.sensing.gateway._meta_skill_routes import (
    _register_capability_catalog_routes,
    _register_capability_permission_routes,
    _register_skill_install_routes,
)

# ═══════════════════════════════════════════════════════════
# Factory
# ═══════════════════════════════════════════════════════════


def create_meta_router(
    *,
    registry: Any,
    tool_registry: Any = None,
    mobile_skills_root: Path | str | None = None,
    feedback_path: Path | str = "data/feedback.jsonl",
    skill_library_dirs: Sequence[Path | str] | None = None,
    include_default_skill_library: bool = False,
    oct_config: Any = None,
    local_auth_config: Any = None,
    identity_store: Any = None,
    jwt_secret: str | None = None,
    jwt_issuer: str | None = None,
    jwt_audience: str | None = None,
    require_auth: bool = False,
) -> Any:
    """Build the FastAPI router.

    ╔════════════════════════════════════════════════════════════════════╗
    ║ meta_router.py · navigation map (closure factory).                 ║
    ║                                                                    ║
    ║   §1 Pydantic models + enums                     (submodule)       ║
    ║   §2 create_meta_router(...) factory                below          ║
    ║       §2.1 feedback endpoints (POST + GET)                          ║
    ║       §2.2 skills browser + enable/disable                          ║
    ║       §2.3 skills install/uninstall                                 ║
    ║       §2.4 user profile (GET + PUT)                                 ║
    ║       §2.5 auth status + usage audit                                ║
    ║       §2.6 architecture docs endpoints                              ║
    ║   §3 helper functions (skill metadata)      → _meta_skill_metadata  ║
    ╚════════════════════════════════════════════════════════════════════╝

    Parameters
    ----------
    registry :
        SkillRegistry — ``/api/skills`` iterates its contents.
    feedback_path :
        JSONL where ``/api/feedback`` appends. Kept as a parameter
        (default preserves the pre-split location) so tests can
        redirect it with ``tmp_path``.
    skill_library_dirs / include_default_skill_library :
        Optional file-backed SKILL.md catalogs to merge into the
        skill browser. These are read-only catalog entries; they do
        not register executable handlers in ``SkillRegistry``.
    oct_config / local_auth_config :
        Optional auth configs. Each is probed by the
        ``auth_providers`` handler for ``enabled`` and the fields
        it surfaces to the UI.
    identity_store / jwt_secret :
        Passed through to ``_resolve_actor`` when tagging feedback
        with the submitting user. Both being ``None`` means
        anonymous feedback still records (tagged ``actor=None``).
    """
    require_fastapi(__name__)

    router = APIRouter(tags=["meta"])
    _feedback_path = Path(feedback_path)
    _skill_library_dirs = [Path(p) for p in (skill_library_dirs or [])]
    if include_default_skill_library:
        default_library = _default_skill_library_dir()
        if default_library not in _skill_library_dirs:
            _skill_library_dirs.append(default_library)

    def _require_admin(request: Request, *, purpose: str) -> None:
        """Require an authenticated admin actor for high-risk operations."""
        try:
            from runtime.sensing.gateway.openai_gateway import _resolve_actor

            actor = _resolve_actor(
                request,
                identity_store,
                True,
                jwt_secret=jwt_secret,
                jwt_issuer=jwt_issuer,
                jwt_audience=jwt_audience,
            )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                401,
                "auth required",
                headers={"X-Echo-Auth-Expired": "1"},
            ) from exc

        if identity_store is None or not actor:
            raise HTTPException(
                401,
                "auth required",
                headers={"X-Echo-Auth-Expired": "1"},
            )

        auth_header = request.headers.get("Authorization") or ""
        if not auth_header.lower().startswith("bearer "):
            raise HTTPException(
                401,
                "missing Authorization: Bearer <token>",
                headers={"X-Echo-Auth-Expired": "1"},
            )

        token = auth_header[7:].strip()
        identity = None
        if jwt_secret and token.count(".") == 2:
            with suppress(Exception):
                identity = identity_store.verify_jwt(
                    token,
                    secret=jwt_secret,
                    required_issuer=jwt_issuer,
                    required_audience=jwt_audience,
                )
        if identity is None:
            with suppress(Exception):
                identity = identity_store.verify_api_key(token)

        roles = getattr(identity, "roles", ()) or ()
        if "admin" not in {str(r).lower() for r in roles}:
            raise HTTPException(403, f"admin role required to {purpose}")

    d = MetaRouterDeps(
        registry=registry,
        tool_registry=tool_registry,
        mobile_skills_root=mobile_skills_root,
        oct_config=oct_config,
        local_auth_config=local_auth_config,
        identity_store=identity_store,
        jwt_secret=jwt_secret,
        jwt_issuer=jwt_issuer,
        jwt_audience=jwt_audience,
        require_auth=require_auth,
        feedback_path=_feedback_path,
        skill_library_dirs=_skill_library_dirs,
        require_admin=_require_admin,
    )

    # Registration order is FastAPI's path-matching priority — keep it.
    _register_feedback_and_skills_routes(router, d)
    _register_capability_catalog_routes(router, d)
    _register_skill_install_routes(router, d)
    _register_capability_permission_routes(router, d)
    _register_auth_routes(router, d)
    _register_architecture_and_mention_routes(router, d)

    return router


# Stays in this module: tests monkeypatch ``meta_router._dynamic_plugin_skill_names``
# (read by ``/api/skills``), and the feedback handler logs via ``__name__``.
def _register_feedback_and_skills_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Reply feedback (record + admin read-back) and the registered skill catalog."""
    registry = d.registry
    identity_store = d.identity_store
    jwt_secret = d.jwt_secret
    jwt_issuer = d.jwt_issuer
    jwt_audience = d.jwt_audience
    _feedback_path = d.feedback_path
    _skill_library_dirs = d.skill_library_dirs
    _require_admin = d.require_admin

    # ─── Feedback ───────────────────────────────────────────

    @router.post("/api/feedback", response_model=FeedbackPostResponse)
    def api_feedback(
        body: dict[str, Any],
        request: Request,
    ) -> dict[str, Any]:
        sentiment = str(body.get("sentiment") or "").strip().lower()
        if sentiment not in ("liked", "disliked"):
            raise HTTPException(
                400,
                "sentiment must be 'liked' or 'disliked'",
            )
        actor: str | None = None
        try:
            from runtime.sensing.gateway.openai_gateway import _resolve_actor

            actor = (
                _resolve_actor(  # AUTH-OK: actor-agnostic — optional attribution for feedback log
                    request,
                    identity_store,
                    False,
                    jwt_secret=jwt_secret,
                    jwt_issuer=jwt_issuer,
                    jwt_audience=jwt_audience,
                )
            )
        except Exception as exc:
            import logging as _logging

            _logging.getLogger(__name__).debug("auth resolution failed: %s", exc)

        entry = {
            "ts": time.time(),
            "sentiment": sentiment,
            "message_id": str(body.get("message_id") or "") or None,
            "thread_id": str(body.get("thread_id") or "") or None,
            "agent_id": str(body.get("agent_id") or "") or None,
            "content_preview": str(body.get("content_preview") or "")[:400] or None,
            "reason": str(body.get("reason") or "")[:200] or None,
            "actor": actor,
        }
        try:
            _feedback_path.parent.mkdir(parents=True, exist_ok=True)
            with _feedback_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as exc:
            raise HTTPException(
                500,
                f"failed to record feedback: {exc}",
            ) from exc
        return {"ok": True, "recorded": entry}

    @router.get("/api/feedback", response_model=FeedbackListResponse)
    def api_feedback_list(
        request: Request,
        limit: int = Query(default=50, ge=1, le=500),
        thread_id: str | None = Query(default=None),
    ) -> dict[str, Any]:
        """Scan recent feedback entries from the end of the JSONL.

        Performance note: full file read per request · fine for the
        admin-dashboard use case (small log, single reader). If
        this ever becomes a hot path, replace with tail-read +
        LRU cache.
        """
        _require_admin(request, purpose="read feedback")
        if not _feedback_path.exists():
            return {"entries": []}
        try:
            lines = _feedback_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return {"entries": []}
        out: list[dict[str, Any]] = []
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                # Single malformed row shouldn't void the whole list
                # — skip and continue. Consider alerting if this
                # happens in prod (corrupted writer).
                continue
            if thread_id and rec.get("thread_id") != thread_id:
                continue
            out.append(rec)
            if len(out) >= limit:
                break
        return {"entries": out}

    # ─── Skills ─────────────────────────────────────────────

    @router.get("/api/skills", response_model=SkillsResponse)
    def api_skills() -> dict[str, Any]:
        skills_by_name: dict[str, dict[str, Any]] = {}
        dynamic_plugin_skills = _dynamic_plugin_skill_names()
        seen_sources: set[str] = set()
        try:
            registry_names = list(registry.all_names())
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("api_skills: registry.all_names failed: %s", exc)
            registry_names = []
        for name in registry_names:
            try:
                s = registry.get(name)
                if _is_hidden_skill_catalog_entry(
                    str(s.name),
                    str(s.trusted_source or ""),
                    dynamic_plugin_skills,
                    seen_sources,
                ):
                    continue
                affinity = list(s.affinity)
                permission_group = _permission_group_for_skill(str(s.name))
                is_enabled = registry.is_enabled(s.name)
                group = _skill_group_for(str(s.name))
                kind = _skill_kind(group, str(s.name))
                market_profile = _skill_market_profile(
                    name=str(s.name),
                    description=str(s.description or ""),
                    trusted_source=str(s.trusted_source or ""),
                    group=group,
                    kind=kind,
                )
                skills_by_name[s.name] = {
                    "name": s.name,
                    "description": s.description,
                    "affinity": affinity,
                    "cost_profile": s.cost_profile,
                    "trusted_source": s.trusted_source,
                    "has_tests": s.has_tests,
                    "enabled": is_enabled,
                    "surface": "permission" if permission_group else "skill",
                    "permission_group": permission_group,
                    "category": _derive_skill_category(s.name, affinity),
                    "group": group,
                    "kind": kind,
                    **market_profile,
                }
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("api_skills: skipping registry skill %s: %s", name, exc)
                continue
        for skill in _load_file_skill_catalog(_skill_library_dirs):
            # Runtime-registered skills win because those entries are
            # executable and carry their real trust/test metadata.
            try:
                # Dynamic plugin names hide executable all_skills registry
                # entries so plugin-owned tools do not appear twice. Do not
                # apply that rule to the read-only file catalog: bundled
                # public SKILL.md entries (for example pdf) are the fallback
                # surface when the executable registry entry was hidden.
                if _is_hidden_skill_catalog_entry(
                    str(skill.get("name") or ""),
                    str(skill.get("trusted_source") or ""),
                    set(),
                    seen_sources,
                ):
                    continue
                skills_by_name.setdefault(skill["name"], skill)
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("api_skills: skipping file skill %s: %s", skill, exc)
                continue
        skills = sorted(
            skills_by_name.values(),
            key=lambda item: str(item.get("name", "")).lower(),
        )
        return {"skills": skills}


def _register_architecture_and_mention_routes(router: APIRouter, d: MetaRouterDeps) -> None:
    """Architecture docs, @-mention autocomplete, and a thread's active agents."""
    registry = d.registry

    #
    #

    ARCHITECTURE_DOCS: dict[str, str] = {  # noqa: N806
        "readme": "docs/architecture/README.md",
        "core-path": "docs/architecture/core-path.md",
        "high-res-map": "docs/architecture/high-res-map.md",
        "high-res-mermaid": "docs/architecture/high-res-map.mermaid.md",
        "chat-modes": "docs/architecture/chat-modes.md",
        "react-self-evo": "docs/architecture/react-self-evolution.md",
        "organ-tiering": "docs/architecture/organ-tiering.md",
        "module-map": "docs/architecture/module-map.md",
        "organ-cerebrum": "docs/architecture/organs/cerebrum.md",
        "organ-ganglia": "docs/architecture/organs/ganglia.md",
        "organ-beak": "docs/architecture/organs/beak.md",
        "organ-hearts": "docs/architecture/organs/hearts.md",
        "organ-chromatophores": "docs/architecture/organs/chromatophores.md",
    }

    @router.get("/api/architecture/docs")
    def list_architecture_docs() -> dict[str, Any]:
        return {
            "docs": [{"id": k, "path": v} for k, v in ARCHITECTURE_DOCS.items()],
        }

    @router.get("/api/architecture/docs/{doc_id}")
    def read_architecture_doc(doc_id: str) -> dict[str, Any]:
        rel = ARCHITECTURE_DOCS.get(doc_id)
        if rel is None:
            raise HTTPException(404, f"unknown doc id: {doc_id!r}")
        p = Path(rel)
        if not p.exists():
            raise HTTPException(404, f"file missing on disk: {rel}")
        try:
            content = p.read_text(encoding="utf-8")
        except OSError as e:
            raise HTTPException(500, f"read failed: {e}") from e
        return {"id": doc_id, "path": rel, "content": content}

    @router.get("/api/mentions/autocomplete")
    def mentions_autocomplete(
        q: str = "",
        workspace: str = "",
        thread_id: str = "",
        actor: str = "",
        scope: str = "all",
        limit: int = 20,
    ) -> dict[str, Any]:
        """Autocomplete suggestions for @-mentions in chat input."""
        return _build_mentions_autocomplete(
            registry=registry,
            q=q,
            workspace=workspace,
            thread_id=thread_id,
            actor=actor,
            scope=scope,
            limit=limit,
        )

    @router.get("/api/threads/{thread_id}/active-agents")
    def thread_active_agents(thread_id: str) -> dict[str, Any]:
        """List agents that have participated in the given thread.

        Pulled from team room membership when the thread is bound to a
        team room, otherwise from message senders in the thread history.
        """
        try:
            agent_ids = _resolve_thread_active_agents(thread_id, registry)
        except (AttributeError, KeyError, TypeError):
            agent_ids = set()
        results: list[dict[str, Any]] = []
        for agent_id in sorted(agent_ids):
            try:
                agent = registry.get(agent_id) if hasattr(registry, "get") else None
            except (AttributeError, KeyError):
                agent = None
            if agent is None:
                results.append(
                    {
                        "id": agent_id,
                        "display_name": agent_id,
                        "description": "",
                    }
                )
                continue
            results.append(
                {
                    "id": agent_id,
                    "display_name": str(getattr(agent, "display_name", "") or agent_id),
                    "description": str(getattr(agent, "description", "") or "")[:200],
                }
            )
        return {"agents": results, "count": len(results)}


__all__ = [
    "create_meta_router",
    "SKILL_CATEGORIES",
    "_derive_skill_category",
    "_resolve_thread_active_agents",
]
_LOG = logging.getLogger(__name__)
