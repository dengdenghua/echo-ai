"""HTTP surface for Narrative Studio core resources, status, MCP and page."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse

from .mcp_server import CANON_POLICY, MCP_ENDPOINT
from .models import (
    BranchCreate,
    ChapterCreate,
    ChapterUpdate,
    EchoImportRequest,
    FactCreate,
    ProjectCreate,
    RevisionActorSource,
    RevisionRestoreRequest,
    SceneCreate,
    SceneUpdate,
    StateChangeCreate,
    WorldPackCreate,
)
from .store import NarrativeStoreError
from .v2_routes import _principal

if TYPE_CHECKING:
    from . import NarrativeStudioPlugin


def _items(rows: list[Any]) -> dict[str, Any]:
    values = [row.model_dump(mode="json") if hasattr(row, "model_dump") else row for row in rows]
    return {"items": values, "total": len(values)}


def _revision_items(rows: list[Any]) -> dict[str, Any]:
    """Return bounded history metadata; full immutable content has a detail route."""

    values = [row.model_dump(mode="json", exclude={"snapshot"}) for row in rows]
    return {"items": values, "total": len(values)}


_IF_MATCH_RE = re.compile(r'^(?:W/)?"?([1-9][0-9]*)"?$')


def _expected_revision(
    request: Request,
    query_value: int | None,
    body_value: int | None,
) -> int | None:
    """Resolve optimistic-concurrency input with HTTP precondition priority."""

    raw = request.headers.get("if-match")
    if raw is not None:
        clean = raw.strip()
        if clean == "*":
            return None
        match = _IF_MATCH_RE.fullmatch(clean)
        if match is None:
            raise NarrativeStoreError("If-Match must contain one positive revision ETag")
        return int(match.group(1))
    return query_value if query_value is not None else body_value


def _revision_identity(request: Request) -> tuple[str, RevisionActorSource]:
    principal = _principal(request)
    if principal:
        return principal, "authenticated_principal"
    return "local", "client_asserted"


def register_core_routes(router: APIRouter, plugin: NarrativeStudioPlugin) -> None:
    def record_response(response: Response, operation: Callable[[], Any]) -> Any:
        value = plugin._api(operation)
        if isinstance(value, dict) and isinstance(value.get("revision"), int):
            response.headers["ETag"] = f'"{value["revision"]}"'
        return value

    @router.get("/status")
    def status() -> dict[str, Any]:
        store = plugin._require_store()
        return {
            "ok": True,
            "plugin": plugin.name,
            "version": plugin.version,
            "canon_policy": CANON_POLICY,
            "canon_governance": "human_confirmed_immutable_snapshot",
            "data_dir": str(store.data_dir),
            "project_count": len(store.list_projects()),
            "echo": plugin._echo_adapter(None).probe(),
            "mcp": {
                "enabled": plugin.mcp_server is not None,
                "endpoint": MCP_ENDPOINT,
                "transport": "json-rpc-http",
                "auth": "host_inherited",
                "tool_policy": "candidate_only_allowlist",
                "tools": plugin._require_mcp_server().tool_names,
            },
            "packaged_skills": [asset.catalog_entry() for asset in plugin.packaged_skill_assets],
            "capabilities": [
                "projects",
                "world_packs",
                "branches",
                "chapters",
                "scenes",
                "facts",
                "state_changes",
                "story_arcs",
                "entities",
                "relationships",
                "foreshadows",
                "source_cited_context_packs",
                "ordered_candidate_pipeline",
                "candidate_revision_history",
                "optimistic_concurrency",
                "human_reviews_and_votes",
                "immutable_canon_commits",
                "echo_read_only_import",
                "candidate_only_mcp",
                "packaged_skill_assets",
            ],
        }

    @router.post("/mcp")
    async def mcp_json_rpc(body: dict[str, Any], request: Request) -> Any:
        actor = _principal(request)
        # Production authentication is owned by the Echo host.  This
        # backstop trusts only its server-resolved principal and never
        # parses a second token or caller-supplied identity field.
        if plugin._host_requires_auth and actor is None:
            raise HTTPException(401, "authenticated Echo principal required")
        result = await plugin._require_mcp_server().handle_request(body, actor=actor)
        if result is None:
            return Response(status_code=202)
        return result

    @router.get("/page", response_class=HTMLResponse)
    def page() -> HTMLResponse:
        plugin_dir = Path(plugin.ctx.plugin_dir)
        path = plugin_dir / "page" / "index.html"
        if not path.is_file():
            raise HTTPException(404, "Narrative Studio page is unavailable")
        return HTMLResponse(path.read_text(encoding="utf-8"))

    @router.get("/projects")
    def list_projects() -> dict[str, Any]:
        return _items(plugin._require_store().list_projects())

    @router.post("/projects", status_code=201)
    def create_project(body: ProjectCreate) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().create_project(body))

    @router.get("/projects/{project_id}")
    def get_project(project_id: str) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().project_detail(project_id))

    @router.get("/projects/{project_id}/world-packs")
    def list_world_packs(project_id: str) -> dict[str, Any]:
        return plugin._api(lambda: _items(plugin._require_store().list_world_packs(project_id)))

    @router.post("/projects/{project_id}/world-packs", status_code=201)
    def create_world_pack(project_id: str, body: WorldPackCreate) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().create_world_pack(project_id, body))

    @router.get("/projects/{project_id}/branches")
    def list_branches(project_id: str) -> dict[str, Any]:
        return plugin._api(lambda: _items(plugin._require_store().list_branches(project_id)))

    @router.post("/projects/{project_id}/branches", status_code=201)
    def create_branch(project_id: str, body: BranchCreate) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().create_branch(project_id, body))

    @router.get("/projects/{project_id}/chapters")
    def list_chapters(
        project_id: str, branch_id: str | None = Query(default=None)
    ) -> dict[str, Any]:
        return plugin._api(
            lambda: _items(plugin._require_store().list_chapters(project_id, branch_id))
        )

    @router.post("/projects/{project_id}/chapters", status_code=201)
    def create_chapter(
        project_id: str,
        body: ChapterCreate,
        request: Request,
        response: Response,
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().create_chapter(
                project_id,
                body,
                actor=actor,
                actor_source=source,
            ),
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}")
    def get_chapter(project_id: str, chapter_id: str, response: Response) -> dict[str, Any]:
        return record_response(
            response,
            lambda: plugin._require_store().get_chapter(project_id, chapter_id),
        )

    @router.put("/projects/{project_id}/chapters/{chapter_id}")
    def update_chapter(
        project_id: str,
        chapter_id: str,
        body: ChapterUpdate,
        request: Request,
        response: Response,
        expected_revision: int | None = Query(default=None, ge=1),
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().update_chapter(
                project_id,
                chapter_id,
                body,
                expected_revision=_expected_revision(
                    request,
                    expected_revision,
                    body.expected_revision,
                ),
                actor=actor,
                actor_source=source,
            ),
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}/revisions")
    def list_chapter_revisions(project_id: str, chapter_id: str) -> dict[str, Any]:
        return plugin._api(
            lambda: _revision_items(
                plugin._require_store().list_chapter_revisions(project_id, chapter_id)
            )
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}/revisions/{revision}")
    def get_chapter_revision(
        project_id: str,
        chapter_id: str,
        revision: int,
        response: Response,
    ) -> dict[str, Any]:
        return record_response(
            response,
            lambda: plugin._require_store().get_chapter_revision(project_id, chapter_id, revision),
        )

    @router.post("/projects/{project_id}/chapters/{chapter_id}/revisions/{revision}/restore")
    def restore_chapter_revision(
        project_id: str,
        chapter_id: str,
        revision: int,
        body: RevisionRestoreRequest,
        request: Request,
        response: Response,
        expected_revision: int | None = Query(default=None, ge=1),
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().restore_chapter_revision(
                project_id,
                chapter_id,
                revision,
                expected_revision=_expected_revision(
                    request,
                    expected_revision,
                    body.expected_revision,
                ),
                actor=actor,
                actor_source=source,
                message=body.message,
            ),
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}/scenes")
    def list_scenes(project_id: str, chapter_id: str) -> dict[str, Any]:
        return plugin._api(
            lambda: _items(plugin._require_store().list_scenes(project_id, chapter_id))
        )

    @router.post("/projects/{project_id}/chapters/{chapter_id}/scenes", status_code=201)
    def create_scene(
        project_id: str,
        chapter_id: str,
        body: SceneCreate,
        request: Request,
        response: Response,
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().create_scene(
                project_id,
                chapter_id,
                body,
                actor=actor,
                actor_source=source,
            ),
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}/scenes/{scene_id}")
    def get_scene(
        project_id: str,
        chapter_id: str,
        scene_id: str,
        response: Response,
    ) -> dict[str, Any]:
        return record_response(
            response,
            lambda: plugin._require_store().get_scene_in_chapter(project_id, chapter_id, scene_id),
        )

    @router.put("/projects/{project_id}/chapters/{chapter_id}/scenes/{scene_id}")
    def update_scene(
        project_id: str,
        chapter_id: str,
        scene_id: str,
        body: SceneUpdate,
        request: Request,
        response: Response,
        expected_revision: int | None = Query(default=None, ge=1),
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().update_scene(
                project_id,
                chapter_id,
                scene_id,
                body,
                expected_revision=_expected_revision(
                    request,
                    expected_revision,
                    body.expected_revision,
                ),
                actor=actor,
                actor_source=source,
            ),
        )

    @router.get("/projects/{project_id}/chapters/{chapter_id}/scenes/{scene_id}/revisions")
    def list_scene_revisions(project_id: str, chapter_id: str, scene_id: str) -> dict[str, Any]:
        return plugin._api(
            lambda: _revision_items(
                plugin._require_store().list_scene_revisions(project_id, chapter_id, scene_id)
            )
        )

    @router.get(
        "/projects/{project_id}/chapters/{chapter_id}/scenes/{scene_id}/revisions/{revision}"
    )
    def get_scene_revision(
        project_id: str,
        chapter_id: str,
        scene_id: str,
        revision: int,
        response: Response,
    ) -> dict[str, Any]:
        return record_response(
            response,
            lambda: plugin._require_store().get_scene_revision(
                project_id, chapter_id, scene_id, revision
            ),
        )

    @router.post(
        "/projects/{project_id}/chapters/{chapter_id}/scenes/{scene_id}/"
        "revisions/{revision}/restore"
    )
    def restore_scene_revision(
        project_id: str,
        chapter_id: str,
        scene_id: str,
        revision: int,
        body: RevisionRestoreRequest,
        request: Request,
        response: Response,
        expected_revision: int | None = Query(default=None, ge=1),
    ) -> dict[str, Any]:
        actor, source = _revision_identity(request)
        return record_response(
            response,
            lambda: plugin._require_store().restore_scene_revision(
                project_id,
                chapter_id,
                scene_id,
                revision,
                expected_revision=_expected_revision(
                    request,
                    expected_revision,
                    body.expected_revision,
                ),
                actor=actor,
                actor_source=source,
                message=body.message,
            ),
        )

    @router.get("/projects/{project_id}/facts")
    def list_facts(project_id: str, branch_id: str | None = Query(default=None)) -> dict[str, Any]:
        return plugin._api(
            lambda: _items(plugin._require_store().list_facts(project_id, branch_id))
        )

    @router.post("/projects/{project_id}/facts", status_code=201)
    def create_fact(project_id: str, body: FactCreate) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().create_fact(project_id, body))

    @router.get("/projects/{project_id}/state-changes")
    def list_state_changes(
        project_id: str, branch_id: str | None = Query(default=None)
    ) -> dict[str, Any]:
        return plugin._api(
            lambda: _items(plugin._require_store().list_state_changes(project_id, branch_id))
        )

    @router.post("/projects/{project_id}/state-changes", status_code=201)
    def create_state_change(project_id: str, body: StateChangeCreate) -> dict[str, Any]:
        return plugin._api(lambda: plugin._require_store().create_state_change(project_id, body))

    @router.post("/projects/{project_id}/imports/echo")
    def import_echo(project_id: str, body: EchoImportRequest) -> dict[str, Any]:
        return plugin._api(lambda: plugin._import_echo(project_id, body))


__all__ = ["register_core_routes"]
