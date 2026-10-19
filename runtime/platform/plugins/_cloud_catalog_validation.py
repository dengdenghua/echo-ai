"""Compatibility validation, workbench state, and marketplace recovery.

Extracted from ``cloud_catalog`` to keep the module under the god-file
threshold. ``CloudCatalog`` mixes this in; cross-cluster helpers are reached
through ``self`` and declared below as ``Any`` attributes.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version

from runtime.platform.io import atomic_write_json
from runtime.platform.plugins import _cloud_catalog_support as _support
from runtime.platform.plugins._cloud_catalog_entries import _WORKBENCH_APPS
from runtime.platform.plugins.marketplace_package import verify_marketplace_package_trust
from runtime.platform.plugins.workbench_activation import WorkbenchActivationStore
from runtime.platform.plugins.workbench_package import (
    WorkbenchPackageDataStore,
    WorkbenchPackageStore,
)


class CloudCatalogValidationMixin:
    """Compatibility gates, workbench package state, and crash recovery."""

    CODEX_CACHE_ROOT: Any
    CONNECTOR_STATE_FILE: Any
    SKILLS_ROOT: Any
    items: Any
    rollback_plugin: Any

    PLUGIN_INSTALL_ROOT: Any
    CAPABILITY_STATE_FILE: Any
    _abort_marketplace_transaction: Any
    _restore_marketplace_transaction_generations: Any
    _write_marketplace_transaction: Any
    _marketplace_transaction_identity: Any
    _marketplace_state_payload: Any
    _marketplace_state_snapshot: Any

    def _validate_marketplace_compatibility(
        self,
        manifest: dict[str, Any],
        *,
        plugin_id: str,
    ) -> None:
        """Gate ordinary packages on their signed host and dependency contract."""

        host_api = str(manifest.get("host_api") or "").strip()
        if host_api:
            try:
                compatible = Version(_support.HOST_API_VERSION) in SpecifierSet(host_api)
            except (InvalidSpecifier, InvalidVersion) as exc:
                raise ValueError(f"invalid marketplace host_api: {host_api}") from exc
            if not compatible:
                raise ValueError(
                    f"marketplace package requires host_api {host_api}; host is {_support.HOST_API_VERSION}"
                )
        for dependency in manifest.get("dependencies") or []:
            if dependency == plugin_id:
                raise ValueError(f"marketplace package depends on itself: {plugin_id}")
            candidates = (
                ("codex", self.PLUGIN_INSTALL_ROOT / "codex" / dependency),
                ("codex", self.CODEX_CACHE_ROOT / dependency),
                ("connector", self.PLUGIN_INSTALL_ROOT / "connector" / dependency),
            )
            available = False
            for kind, path in candidates:
                if not path.is_dir() or path.is_symlink():
                    continue
                try:
                    verify_marketplace_package_trust(
                        path,
                        package_kind=kind,
                        plugin_id=dependency,
                        require_trusted=not (_support.REPO / ".git").exists(),
                    )
                except (FileNotFoundError, ValueError):
                    continue
                available = True
                break
            if not available:
                raise ValueError(f"missing trusted marketplace dependency: {dependency}")

    def _validate_workbench_compatibility(
        self,
        manifest: Any,
        *,
        install_root: Path,
        installed: bool = False,
    ) -> None:
        official = next(
            (
                item
                for item in _WORKBENCH_APPS
                if item.get("kind") == "workbench" and item.get("plugin") == manifest.id
            ),
            None,
        )
        if official is None and not installed:
            official = next(
                (
                    item
                    for item in self.items()
                    if item.get("kind") == "workbench" and item.get("plugin") == manifest.id
                ),
                None,
            )
        if official is not None:
            expected_version = str(official.get("version") or "").strip()
            if not installed and expected_version and manifest.version != expected_version:
                raise ValueError(
                    f"workbench version mismatch: expected {expected_version}, "
                    f"got {manifest.version}"
                )
            expected_runtime = str(official.get("runtime_plugin") or "").strip() or None
            if expected_runtime != manifest.runtime_plugin:
                raise ValueError("workbench runtime plugin identity does not match catalog")
        if "host.same_origin" in manifest.permissions and not (
            official is not None and official.get("source") == "echo"
        ):
            raise ValueError("host.same_origin is reserved for trusted first-party workbenches")
        if manifest.host_api:
            try:
                compatible = Version(_support.HOST_API_VERSION) in SpecifierSet(manifest.host_api)
            except (InvalidSpecifier, InvalidVersion) as exc:
                raise ValueError(f"invalid workbench host_api: {manifest.host_api}") from exc
            if not compatible:
                raise ValueError(
                    f"workbench requires host_api {manifest.host_api}; host is {_support.HOST_API_VERSION}"
                )
        for dependency in manifest.dependencies:
            dependency_path = install_root / dependency
            if not dependency_path.is_dir():
                raise ValueError(f"missing workbench dependency: {dependency}")
            WorkbenchPackageStore(install_root).load_manifest(dependency)

    @staticmethod
    def _transaction_matches(path: Path, *, plugin_id: str, status: str) -> bool:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return False
        return (
            isinstance(payload, dict)
            and payload.get("plugin_id") == plugin_id
            and payload.get("status") == status
        )

    @staticmethod
    def _version_is_newer(candidate: str, installed: str) -> bool:
        try:
            return Version(candidate) > Version(installed)
        except InvalidVersion:
            return candidate != installed

    def _workbench_package_state_path(self) -> Path:
        return self.PLUGIN_INSTALL_ROOT / "workbench" / ".lifecycle" / "enabled.json"

    def _workbench_package_state(self) -> dict[str, bool]:
        path = self._workbench_package_state_path()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            str(plugin_id): enabled
            for plugin_id, enabled in payload.items()
            if isinstance(plugin_id, str) and isinstance(enabled, bool)
        }

    def _workbench_package_enabled(self, plugin_id: str) -> bool:
        return self._workbench_package_state().get(plugin_id, True)

    def _ensure_workbench_not_required(
        self,
        plugin_id: str,
        *,
        enabled_only: bool = False,
    ) -> None:
        root = self.PLUGIN_INSTALL_ROOT / "workbench"
        if not root.is_dir():
            return
        dependents: list[str] = []
        store = WorkbenchPackageStore(root, require_integrity=True)
        for candidate in root.iterdir():
            if not candidate.is_dir() or candidate.name.startswith("."):
                continue
            if enabled_only and not self._workbench_package_enabled(candidate.name):
                continue
            try:
                manifest = store.load_manifest(candidate.name)
            except (FileNotFoundError, ValueError):
                continue
            if plugin_id in manifest.dependencies:
                dependents.append(candidate.name)
        if dependents:
            raise ValueError(
                f"workbench is required by installed packages: {', '.join(sorted(dependents))}"
            )

    def _rollback_dependency_installs(self, rows: list[dict[str, Any]]) -> None:
        consumed: set[str] = set()
        for row in reversed(rows):
            transaction_id = str(row.get("transaction_id") or "")
            plugin_id = str(row.get("plugin_id") or "")
            plugin_kind = str(row.get("kind") or "workbench")
            if not transaction_id or transaction_id in consumed:
                continue
            self.rollback_plugin(
                plugin_id,
                plugin_kind=plugin_kind,
                transaction_id=transaction_id,
            )
            consumed.add(transaction_id)

    def _latest_workbench_transaction(self, plugin_id: str) -> dict[str, Any] | None:
        transactions = self.PLUGIN_INSTALL_ROOT / "workbench" / ".lifecycle" / "transactions"
        candidates: list[dict[str, Any]] = []
        for path in transactions.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if (
                isinstance(payload, dict)
                and payload.get("plugin_id") == plugin_id
                and payload.get("status") == "committed"
                and payload.get("rollback_available") is True
            ):
                candidates.append(payload)
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda payload: (
                str(payload.get("committed_at") or ""),
                str(payload.get("transaction_id") or ""),
            ),
        )

    def _latest_marketplace_transaction(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
    ) -> dict[str, Any] | None:
        transactions = self.PLUGIN_INSTALL_ROOT / plugin_kind / ".lifecycle" / "transactions"
        candidates: list[dict[str, Any]] = []
        for path in transactions.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if (
                isinstance(payload, dict)
                and payload.get("schema") == "echo.marketplace_package_transaction.v1"
                and payload.get("plugin_id") == plugin_id
                and payload.get("kind") == plugin_kind
                and payload.get("status") == "committed"
                and payload.get("rollback_available") is True
            ):
                candidates.append(payload)
        if not candidates:
            return None
        return max(
            candidates,
            key=lambda payload: (
                str(payload.get("committed_at") or ""),
                str(payload.get("transaction_id") or ""),
            ),
        )

    def _recover_incomplete_marketplace_transactions(
        self,
        *,
        plugin_kind: str | None = None,
    ) -> None:
        kinds = (plugin_kind,) if plugin_kind is not None else ("codex", "connector")
        for kind in kinds:
            if kind not in {"codex", "connector"}:
                raise ValueError(f"unsupported marketplace package kind: {kind}")
            dest = self.PLUGIN_INSTALL_ROOT / kind
            self._recover_orphaned_marketplace_staging(dest, plugin_kind=kind)
            transactions = dest / ".lifecycle" / "transactions"
            for path in sorted(transactions.glob("*.json")):
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ValueError(
                        f"marketplace transaction journal is invalid: {path.name}"
                    ) from exc
                if not isinstance(record, dict):
                    raise ValueError(f"marketplace transaction journal is invalid: {path.name}")
                if record.get("status") not in {"package_committed", "skills_committed"}:
                    continue
                if record.get("kind") != kind:
                    raise ValueError(f"marketplace transaction kind mismatch: {path.name}")
                self._abort_marketplace_transaction(record, dest=dest)

    def _recover_orphaned_marketplace_staging(
        self,
        dest: Path,
        *,
        plugin_kind: str,
    ) -> None:
        staging_root = dest / ".lifecycle" / "staging"
        for container in sorted(staging_root.iterdir()) if staging_root.is_dir() else []:
            if not container.is_dir() or container.is_symlink():
                raise ValueError("marketplace staging transaction is invalid")
            transaction_id = container.name
            if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
                raise ValueError("marketplace staging transaction id is invalid")
            transaction_path = dest / ".lifecycle" / "transactions" / f"{transaction_id}.json"
            if transaction_path.is_file():
                continue
            intent_path = container / "intent.json"
            try:
                intent = json.loads(intent_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("marketplace staging intent is invalid") from exc
            plugin_id = str(intent.get("plugin_id") or "") if isinstance(intent, dict) else ""
            if (
                not isinstance(intent, dict)
                or intent.get("schema") != "echo.marketplace_package_intent.v1"
                or intent.get("transaction_id") != transaction_id
                or intent.get("kind") != plugin_kind
                or intent.get("operation") not in {"install", "update"}
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", plugin_id)
            ):
                raise ValueError("marketplace staging intent is invalid")
            target = dest / plugin_id
            staged = container / plugin_id
            backup_parent = dest / ".lifecycle" / "backups" / transaction_id
            backup = backup_parent / plugin_id
            failed = dest / ".lifecycle" / "failed" / transaction_id / plugin_id
            if any(path.is_symlink() for path in (target, staged, backup, failed)):
                raise ValueError("refusing to recover symlinked marketplace staging")
            if intent["operation"] == "update":
                if backup.is_dir():
                    failed.parent.mkdir(parents=True, exist_ok=True)
                    if target.is_dir():
                        target.replace(failed)
                    backup.replace(target)
                elif not target.is_dir():
                    raise ValueError("orphaned marketplace update lost the previous generation")
            elif not staged.is_dir() and target.is_dir():
                failed.parent.mkdir(parents=True, exist_ok=True)
                target.replace(failed)
            shutil.rmtree(container, ignore_errors=True)
            shutil.rmtree(backup_parent, ignore_errors=True)
            shutil.rmtree(failed.parent, ignore_errors=True)

    def _invalidate_marketplace_transactions(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
    ) -> None:
        dest = self.PLUGIN_INSTALL_ROOT / plugin_kind
        transactions = dest / ".lifecycle" / "transactions"
        for path in sorted(transactions.glob("*.json")):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            if not isinstance(record, dict) or record.get("plugin_id") != plugin_id:
                continue
            transaction_id = str(record.get("transaction_id") or "")
            if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
                continue
            record.update(
                {
                    "status": "invalidated_uninstalled",
                    "rollback_available": False,
                    "invalidated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                }
            )
            atomic_write_json(path, record, sort_keys=True)
            shutil.rmtree(
                dest / ".lifecycle" / "backups" / transaction_id,
                ignore_errors=True,
            )
            shutil.rmtree(
                self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id,
                ignore_errors=True,
            )

    def _mark_marketplace_package_uninstalled(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
    ) -> None:
        if plugin_kind == "connector" and self.CONNECTOR_STATE_FILE.exists():
            try:
                state = json.loads(self.CONNECTOR_STATE_FILE.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                state = {}
            if isinstance(state, dict) and isinstance(state.get(plugin_id), dict):
                state[plugin_id].update(installed=False, enabled=False)
                atomic_write_json(self.CONNECTOR_STATE_FILE, state, sort_keys=True)
        elif plugin_kind == "codex":
            try:
                state = json.loads(self.CAPABILITY_STATE_FILE.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                state = {}
            if isinstance(state, dict):
                state.pop(plugin_id, None)
                self.CAPABILITY_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
                atomic_write_json(self.CAPABILITY_STATE_FILE, state, sort_keys=True)

    def _workbench_activation_store(self) -> WorkbenchActivationStore:
        return WorkbenchActivationStore(
            root=self.PLUGIN_INSTALL_ROOT / "workbench",
            data_root=self.PLUGIN_INSTALL_ROOT.parent,
            factory_root=_support.REPO / "runtime" / "platform" / "plugins" / "bundled",
            trash_root=self.PLUGIN_INSTALL_ROOT / ".trash",
        )

    def _workbench_data_store(self) -> WorkbenchPackageDataStore:
        return WorkbenchPackageDataStore(
            root=self.PLUGIN_INSTALL_ROOT.parent,
            trash_root=self.PLUGIN_INSTALL_ROOT / ".trash" / "workbench",
        )
