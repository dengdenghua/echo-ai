"""Owned deployment manifest shared by ``deploy_website`` and the HTTP routes.

``deploy_website`` copies an agent-built static site into
``<data_dir>/deployments/<id>/`` and appends a record to ``manifest.json``.
The first version of that record carried no owner, so every signed-in user
could list and open every deployment. Records now carry the principal that
published them (``owner_actor_id`` + ``tenant_id``, plus the thread when the
tool ran inside one), and every reader goes through :func:`deployment_visible`.

Records written before ownership existed are migrated conservatively: a
record whose source folder sits inside a thread workspace inherits that
thread's owner (see :func:`attribute_unowned_deployments`); anything else
stays unowned and is visible to admins only, never to every signed-in user.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from runtime.platform.io.atomic import (
    _cross_process_lock,
    atomic_write_json,
    read_json_with_backup,
)
from runtime.platform.process import paths as _paths

_logger = logging.getLogger(__name__)
_LOCK = threading.RLock()
MANIFEST_NAME = "manifest.json"
#: Marks a pre-ownership record the migration could not attribute.
LEGACY_UNOWNED_KEY = "legacy_unowned"


def deployments_root() -> Path:
    # Looked up at call time so tests (and data-dir overrides) that patch
    # ``paths.app_paths`` redirect every deployment read and write.
    return _paths.app_paths().data_dir / "deployments"


def _manifest_path(root: Path | None = None) -> Path:
    return (root or deployments_root()) / MANIFEST_NAME


def load_manifest(root: Path | None = None) -> dict[str, Any]:
    """Return the manifest; a missing or corrupt file reads as empty."""
    data = read_json_with_backup(_manifest_path(root), default=None)
    if not isinstance(data, dict) or not isinstance(data.get("deployments"), list):
        return {"deployments": []}
    return data


def _save_manifest(manifest: dict[str, Any], root: Path | None = None) -> None:
    path = _manifest_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_json(path, manifest)


def _entries_of(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    raw = manifest.get("deployments")
    return [entry for entry in raw or [] if isinstance(entry, dict) and entry.get("id")]


def deployment_entries(root: Path | None = None) -> list[dict[str, Any]]:
    return _entries_of(load_manifest(root))


def current_tool_principal() -> tuple[str, str, str]:
    """Best-effort ``(actor_id, tenant_id, thread_id)`` of the running tool call.

    Server-owned sources only: the host execution request, then the trusted
    session scope, then the journal context the gateways bind. Empty strings
    mean "no authenticated principal" (local single-user mode).
    """
    actor = tenant = thread = ""
    try:
        from runtime.execution.request import current_execution_request

        request = current_execution_request()
        if request is not None:
            actor = str(request.task.actor_id or "")
            tenant = str(request.task.tenant_id or "")
            thread = str(request.task.thread_id or "")
    except (ImportError, AttributeError):  # best-effort: tool may run outside a host turn
        pass
    if not actor:
        try:
            from runtime.platform.capabilities.tenant_context import current_capability_scope

            scope = current_capability_scope()
            if scope is not None:
                actor, tenant = scope.actor_id, scope.tenant_id
        except (ImportError, ValueError, AttributeError):  # noqa: BLE001
            # best-effort: the session scope is incomplete, keep looking.
            pass
    if not actor:
        from runtime.memory.journal.journal_context import (
            current_conversation_id,
            current_owner_actor_id,
            current_tenant_id,
        )

        actor = str(current_owner_actor_id() or "")
        tenant = str(current_tenant_id() or "") if actor else ""
        thread = thread or str(current_conversation_id() or "")
    return actor, tenant, thread


def record_deployment(
    *,
    deploy_id: str,
    label: str,
    source: Path,
    dest: Path,
    url: str,
    created_at: float,
    app: dict[str, Any] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    """Prepend an owned record for a freshly copied deployment."""
    actor, tenant, thread = current_tool_principal()
    record: dict[str, Any] = {
        "id": deploy_id,
        "label": label,
        "source": str(source),
        "path": str(dest),
        "url": url,
        "created_at": created_at,
        "owner_actor_id": actor,
        "tenant_id": tenant,
    }
    if app is not None:
        record["app"] = app
    if thread:
        record["thread_id"] = thread
    path = _manifest_path(root)
    with _LOCK, _cross_process_lock(path):
        manifest = load_manifest(root)
        manifest["deployments"] = [record, *_entries_of(manifest)]
        _save_manifest(manifest, root)
    return record


def deployment_visible(
    entry: dict[str, Any],
    *,
    actor_id: str | None,
    tenant_id: str | None,
    roles: frozenset[str] | set[str] | tuple[str, ...] = (),
) -> bool:
    """Owner-only visibility. ``actor_id is None`` means auth is off."""
    if actor_id is None:
        return True
    owner = str(entry.get("owner_actor_id") or "").strip()
    if not owner:
        # Unowned (pre-ownership or unattributable): admins only.
        return "admin" in roles
    stored_tenant = str(entry.get("tenant_id") or "").strip()
    if stored_tenant and tenant_id and stored_tenant != tenant_id:
        return False
    return owner == actor_id


def find_deployment(deployment_id: str, root: Path | None = None) -> dict[str, Any] | None:
    for entry in deployment_entries(root):
        if entry.get("id") == deployment_id:
            return entry
    return None


def deployment_dir(deployment_id: str, root: Path | None = None) -> Path | None:
    """The copied site folder, or None for an unsafe or unknown id."""
    base = (root or deployments_root()).resolve()
    clean = Path(deployment_id).name
    if not clean or clean != deployment_id or clean in {".", ".."}:
        return None
    candidate = (base / clean).resolve()
    if candidate.parent != base or not candidate.is_dir():
        return None
    return candidate


def site_group_key(entry: dict[str, Any]) -> str:
    """Deployments of the same source folder are versions of one site."""
    source = str(entry.get("source") or "").strip()
    basis = source.replace("\\", "/").rstrip("/").lower() if source else str(entry.get("id"))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def remove_deployments(ids: set[str], root: Path | None = None) -> int:
    """Drop records and their copied folders; returns how many were removed."""
    path = _manifest_path(root)
    removed = 0
    with _LOCK, _cross_process_lock(path):
        manifest = load_manifest(root)
        kept: list[dict[str, Any]] = []
        for entry in _entries_of(manifest):
            if entry.get("id") not in ids:
                kept.append(entry)
                continue
            folder = deployment_dir(str(entry.get("id")), root)
            if folder is not None:
                shutil.rmtree(folder, ignore_errors=True)
            removed += 1
        manifest["deployments"] = kept
        _save_manifest(manifest, root)
    return removed


def attribute_unowned_deployments(
    resolve_owner: Callable[[Path], tuple[str, str, str] | None],
    root: Path | None = None,
) -> int:
    """One-time safe migration for records written before ownership.

    ``resolve_owner`` maps a deployment's source folder to the
    ``(actor_id, tenant_id, thread_id)`` of the thread workspace containing
    it. Records it cannot attribute are marked ``legacy_unowned`` and stay
    admin-only. Already-owned and already-marked records are left alone.
    """
    path = _manifest_path(root)
    if not path.is_file():
        return 0
    changed = 0
    with _LOCK, _cross_process_lock(path):
        manifest = load_manifest(root)
        entries = _entries_of(manifest)
        for entry in entries:
            if entry.get("owner_actor_id") or entry.get(LEGACY_UNOWNED_KEY):
                continue
            owner: tuple[str, str, str] | None = None
            source = str(entry.get("source") or "").strip()
            if source:
                try:
                    owner = resolve_owner(Path(source))
                except (OSError, ValueError):
                    owner = None
            if owner and owner[0]:
                entry["owner_actor_id"], entry["tenant_id"] = owner[0], owner[1]
                if owner[2]:
                    entry["thread_id"] = owner[2]
            else:
                entry["owner_actor_id"] = ""
                entry[LEGACY_UNOWNED_KEY] = True
            changed += 1
        if changed:
            manifest["deployments"] = entries
            _save_manifest(manifest, root)
            _logger.info("deployments: attributed %d pre-ownership record(s)", changed)
    return changed


def public_deployment(entry: dict[str, Any]) -> dict[str, Any]:
    """Fields safe to return to the owner: never the absolute server paths."""
    return {key: entry[key] for key in ("id", "label", "url", "created_at", "app") if key in entry}


__all__ = [
    "LEGACY_UNOWNED_KEY",
    "attribute_unowned_deployments",
    "current_tool_principal",
    "deployment_dir",
    "deployment_entries",
    "deployment_visible",
    "deployments_root",
    "find_deployment",
    "load_manifest",
    "public_deployment",
    "record_deployment",
    "remove_deployments",
    "site_group_key",
]
