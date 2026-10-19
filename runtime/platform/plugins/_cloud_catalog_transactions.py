"""Marketplace/workbench transaction commit, restore, and undo paths.

Extracted from ``cloud_catalog`` to keep the module under the god-file
threshold. ``CloudCatalog`` mixes this in.
"""

from __future__ import annotations

import contextlib
import json
import re
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json
from runtime.platform.plugins import _cloud_catalog_support as _support
from runtime.platform.plugins.marketplace_package import verify_marketplace_package_trust
from runtime.platform.plugins.workbench_package import (
    WorkbenchPackageStore,
    verify_workbench_package_trust,
)


class CloudCatalogTransactionsMixin:
    """Two-phase marketplace transactions with staged rollback."""

    _recover_partial_marketplace_skill_generation: Any
    _restore_marketplace_skill_generation: Any
    _skill_registry: Any
    _validated_marketplace_skill_generation: Any
    _verify_marketplace_skill_projection: Any

    PLUGIN_INSTALL_ROOT: Any
    CAPABILITY_STATE_FILE: Any
    SKILLS_ROOT: Any
    _marketplace_skill_record: Any
    _validate_marketplace_compatibility: Any
    _validate_workbench_compatibility: Any
    _marketplace_state_snapshot: Any
    _marketplace_package_enabled: Any
    _marketplace_permission_store: Any
    _ensure_workbench_not_required: Any
    _remove_bundled_skill_ids: Any
    _copy_bundled_skills: Any
    _bundled_skill_ids: Any
    _marketplace_package_skill_sources: Any
    _restore_marketplace_state: Any

    def _commit_workbench_package(
        self,
        source: Path,
        *,
        target: Path,
        dest: Path,
        plugin_id: str,
        require_trusted: bool,
    ) -> dict[str, Any]:
        if target.is_symlink():
            raise ValueError(f"workbench package target cannot be a symlink: {plugin_id}")
        transaction_id = uuid.uuid4().hex
        lifecycle = dest / ".lifecycle"
        staging_container = lifecycle / "staging" / transaction_id
        staging = staging_container / plugin_id
        backup = lifecycle / "backups" / transaction_id / plugin_id
        transaction_path = lifecycle / "transactions" / f"{transaction_id}.json"
        trust_path = lifecycle / "trust" / f"{plugin_id}.json"
        previous_trust = backup.parent / "trust.json"
        had_target = target.exists()
        operation = "update" if had_target else "install"
        previous_valid = False
        try:
            staging_container.mkdir(parents=True, exist_ok=False)
            shutil.copytree(source, staging)
            manifest = WorkbenchPackageStore(staging_container).load_manifest(plugin_id)
            self._validate_workbench_compatibility(manifest, install_root=dest)
            trust = verify_workbench_package_trust(
                staging,
                manifest,
                require_trusted=require_trusted,
            )
            if had_target:
                backup.parent.mkdir(parents=True, exist_ok=False)
                if trust_path.is_file():
                    try:
                        WorkbenchPackageStore(
                            dest,
                            require_integrity=True,
                        ).load_manifest(plugin_id)
                    except (
                        FileNotFoundError,
                        ValueError,
                    ):  # intentional: Retain damaged content as forensic backup only.
                        # A repair must still be able to replace an installed
                        # generation that the current manifest or integrity
                        # rules reject. Keep it as forensic backup, but never
                        # advertise that broken generation as rollback-safe.
                        pass
                    else:
                        shutil.copy2(trust_path, previous_trust)
                        previous_valid = True
                else:
                    try:
                        previous_manifest = WorkbenchPackageStore(dest).load_manifest(plugin_id)
                        previous_record = verify_workbench_package_trust(
                            target,
                            previous_manifest,
                            require_trusted=False,
                        )
                    except (
                        FileNotFoundError,
                        ValueError,
                    ):  # intentional: Do not mark an unverifiable legacy package rollback-safe.
                        pass
                    else:
                        previous_record.update(
                            {
                                "source": "legacy_local",
                                "installed_at": None,
                                "transaction_id": None,
                            }
                        )
                        atomic_write_json(previous_trust, previous_record, sort_keys=True)
                        previous_valid = True
                target.replace(backup)
            try:
                staging.replace(target)
            except Exception:
                if backup.exists() and not target.exists():
                    backup.replace(target)
                raise
        except Exception:
            shutil.rmtree(staging_container, ignore_errors=True)
            raise
        record = {
            "schema": "echo.workbench_package_transaction.v1",
            "transaction_id": transaction_id,
            "plugin_id": plugin_id,
            "operation": operation,
            "status": "committed",
            "version": manifest.version,
            "runtime_plugin": manifest.runtime_plugin,
            "destination": str(target),
            "backup": str(backup) if backup.exists() else "",
            "committed_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "rollback_available": not had_target or previous_valid,
        }
        trust.update(
            {
                "transaction_id": transaction_id,
                "installed_at": record["committed_at"],
                "source": "publisher" if trust["publisher_verified"] else "local_dev",
            }
        )
        try:
            transaction_path.parent.mkdir(parents=True, exist_ok=True)
            trust_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_json(transaction_path, record, sort_keys=True)
            atomic_write_json(trust_path, trust, sort_keys=True)
        except Exception:
            if target.exists() and not staging.exists():
                target.replace(staging)
            if backup.exists() and not target.exists():
                backup.replace(target)
            if previous_trust.is_file():
                previous_trust.replace(trust_path)
            else:
                with contextlib.suppress(OSError):
                    trust_path.unlink()
            with contextlib.suppress(OSError):
                transaction_path.unlink()
            shutil.rmtree(staging_container, ignore_errors=True)
            raise
        shutil.rmtree(staging_container, ignore_errors=True)
        record["trust"] = trust
        return record

    def _commit_marketplace_package(
        self,
        source: Path,
        *,
        target: Path,
        dest: Path,
        plugin_id: str,
        package_kind: str,
        expected_version: str | None,
        require_trusted: bool,
    ) -> dict[str, Any]:
        """Stage and atomically switch one Codex or connector generation."""

        if package_kind not in {"codex", "connector"}:
            raise ValueError(f"unsupported marketplace package kind: {package_kind}")
        if target.is_symlink():
            raise ValueError(f"marketplace package target cannot be a symlink: {plugin_id}")
        transaction_id = uuid.uuid4().hex
        lifecycle = dest / ".lifecycle"
        staging_container = lifecycle / "staging" / transaction_id
        staging = staging_container / plugin_id
        backup = lifecycle / "backups" / transaction_id / plugin_id
        transaction_path = lifecycle / "transactions" / f"{transaction_id}.json"
        trust_path = lifecycle / "trust" / f"{plugin_id}.json"
        previous_trust = backup.parent / "trust.json"
        operation = "update" if target.exists() else "install"
        previous_valid = False
        previous_version: str | None = None
        had_target = target.exists()
        try:
            staging_container.mkdir(parents=True, exist_ok=False)
            shutil.copytree(source, staging)
            trust = verify_marketplace_package_trust(
                staging,
                package_kind=package_kind,
                plugin_id=plugin_id,
                expected_version=expected_version,
                require_trusted=require_trusted,
            )
            self._validate_marketplace_compatibility(
                trust,
                plugin_id=plugin_id,
            )
            if had_target:
                backup.parent.mkdir(parents=True, exist_ok=False)
                try:
                    old_trust = verify_marketplace_package_trust(
                        target,
                        package_kind=package_kind,
                        plugin_id=plugin_id,
                        require_trusted=require_trusted,
                    )
                except (FileNotFoundError, ValueError):
                    old_trust = None
                else:
                    previous_valid = True
                    previous_version = str(old_trust["version"])
                if trust_path.is_file():
                    shutil.copy2(trust_path, previous_trust)
                elif old_trust is not None:
                    atomic_write_json(previous_trust, old_trust, sort_keys=True)
            atomic_write_json(
                staging_container / "intent.json",
                {
                    "schema": "echo.marketplace_package_intent.v1",
                    "transaction_id": transaction_id,
                    "plugin_id": plugin_id,
                    "kind": package_kind,
                    "operation": operation,
                },
                sort_keys=True,
            )
            if had_target:
                target.replace(backup)
            try:
                staging.replace(target)
            except Exception:
                if backup.exists() and not target.exists():
                    backup.replace(target)
                raise
        except Exception:
            shutil.rmtree(staging_container, ignore_errors=True)
            raise

        committed_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        rollback_candidate = not had_target or previous_valid
        record = {
            "schema": "echo.marketplace_package_transaction.v1",
            "transaction_id": transaction_id,
            "plugin_id": plugin_id,
            "kind": package_kind,
            "operation": operation,
            "status": "package_committed",
            "version": trust["version"],
            "previous_version": previous_version,
            "destination": str(target),
            "backup": str(backup) if backup.exists() else "",
            "committed_at": committed_at,
            "rollback_candidate": rollback_candidate,
            "rollback_available": False,
            "skills": None,
            "state_before": None,
        }
        trust.update(
            {
                "transaction_id": transaction_id,
                "installed_at": committed_at,
                "source": "publisher" if trust["publisher_verified"] else "local_dev",
            }
        )
        try:
            transaction_path.parent.mkdir(parents=True, exist_ok=True)
            trust_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_json(transaction_path, record, sort_keys=True)
            atomic_write_json(trust_path, trust, sort_keys=True)
        except Exception:
            if target.exists() and not staging.exists():
                target.replace(staging)
            if backup.exists() and not target.exists():
                backup.replace(target)
            if previous_trust.is_file():
                previous_trust.replace(trust_path)
            else:
                with contextlib.suppress(OSError):
                    trust_path.unlink()
            with contextlib.suppress(OSError):
                transaction_path.unlink()
            shutil.rmtree(staging_container, ignore_errors=True)
            raise
        shutil.rmtree(staging_container, ignore_errors=True)
        record["trust"] = trust
        return record

    def _write_marketplace_transaction(
        self,
        record: dict[str, Any],
        *,
        dest: Path,
    ) -> None:
        transaction_id = str(record.get("transaction_id") or "")
        if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
            raise ValueError("invalid marketplace transaction record")
        transaction_path = dest / ".lifecycle" / "transactions" / f"{transaction_id}.json"
        atomic_write_json(transaction_path, record, sort_keys=True)

    def _finalize_marketplace_transaction(
        self,
        record: dict[str, Any],
        *,
        dest: Path | None = None,
    ) -> None:
        if record.get("rollback_available") is True:
            return
        transaction_id = str(record.get("transaction_id") or "")
        plugin_id = str(record.get("plugin_id") or "")
        package_kind = str(record.get("kind") or "")
        if (
            not re.fullmatch(r"[a-f0-9]{32}", transaction_id)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", plugin_id)
            or package_kind not in {"codex", "connector"}
        ):
            raise ValueError("invalid marketplace transaction record")
        kind_root = dest or (self.PLUGIN_INSTALL_ROOT / package_kind)
        backup_parent = kind_root / ".lifecycle" / "backups" / transaction_id
        shutil.rmtree(backup_parent, ignore_errors=True)
        skill_lifecycle = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id
        shutil.rmtree(skill_lifecycle, ignore_errors=True)

    def _abort_marketplace_transaction(
        self,
        record: dict[str, Any],
        *,
        dest: Path | None = None,
    ) -> None:
        transaction_id, plugin_id, package_kind = self._marketplace_transaction_identity(record)
        kind_root = dest or (self.PLUGIN_INSTALL_ROOT / package_kind)
        self._restore_marketplace_transaction_generations(record, dest=kind_root)
        record.update(
            {
                "status": "aborted",
                "aborted_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "rollback_available": False,
            }
        )
        transaction_path = kind_root / ".lifecycle" / "transactions" / f"{transaction_id}.json"
        with contextlib.suppress(OSError, TypeError, ValueError):
            atomic_write_json(transaction_path, record, sort_keys=True)
        shutil.rmtree(
            kind_root / ".lifecycle" / "failed" / transaction_id,
            ignore_errors=True,
        )
        shutil.rmtree(
            kind_root / ".lifecycle" / "backups" / transaction_id,
            ignore_errors=True,
        )
        shutil.rmtree(
            kind_root / ".lifecycle" / "staging" / transaction_id,
            ignore_errors=True,
        )
        shutil.rmtree(
            self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id,
            ignore_errors=True,
        )

    @staticmethod
    def _marketplace_transaction_identity(
        record: Any,
    ) -> tuple[str, str, str]:
        if not isinstance(record, dict):
            raise ValueError("invalid marketplace transaction record")
        transaction_id = str(record.get("transaction_id") or "")
        plugin_id = str(record.get("plugin_id") or "")
        package_kind = str(record.get("kind") or "")
        if (
            not re.fullmatch(r"[a-f0-9]{32}", transaction_id)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", plugin_id)
            or package_kind not in {"codex", "connector"}
        ):
            raise ValueError("invalid marketplace transaction record")
        return transaction_id, plugin_id, package_kind

    def _restore_marketplace_transaction_generations(
        self,
        record: dict[str, Any],
        *,
        dest: Path,
    ) -> str:
        transaction_id, plugin_id, package_kind = self._marketplace_transaction_identity(record)
        current_state = self._marketplace_state_snapshot(
            plugin_id,
            plugin_kind=package_kind,
        )
        permission_store = self._marketplace_permission_store()
        restore_permission = "permission_before" in record
        current_permission = permission_store.snapshot(plugin_id) if restore_permission else None
        skills_restored = False
        package_restored = False
        permission_restored = False
        try:
            skills_payload = record.get("skills")
            if skills_payload is None:
                skill_journal = (
                    self.SKILLS_ROOT
                    / ".lifecycle"
                    / "marketplace"
                    / transaction_id
                    / "generation.json"
                )
                if skill_journal.is_file():
                    try:
                        skills_payload = json.loads(skill_journal.read_text(encoding="utf-8"))
                    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                        raise ValueError("marketplace skill recovery journal is invalid") from exc
                    record["skills"] = skills_payload
            if skills_payload is not None:
                if (
                    record.get("status") != "package_committed"
                    and record.get("operation") == "update"
                    and record.get("rollback_candidate") is True
                ):
                    _current_ids, _previous_ids, _current_registry, previous_registry = (
                        self._validated_marketplace_skill_generation(
                            skills_payload,
                            plugin_id=plugin_id,
                        )
                    )
                    self._verify_marketplace_skill_projection(
                        dest / ".lifecycle" / "backups" / transaction_id / plugin_id,
                        plugin_id=plugin_id,
                        skills_container=(
                            self.SKILLS_ROOT
                            / ".lifecycle"
                            / "marketplace"
                            / transaction_id
                            / "backup"
                        ),
                        registry_entries=previous_registry,
                    )
                try:
                    self._restore_marketplace_skill_generation(
                        skills_payload,
                        plugin_id=plugin_id,
                        transaction_id=transaction_id,
                        keep_failed=True,
                    )
                except ValueError:
                    if record.get("status") != "package_committed":
                        raise
                    self._recover_partial_marketplace_skill_generation(
                        skills_payload,
                        plugin_id=plugin_id,
                        transaction_id=transaction_id,
                    )
                skills_restored = True
            operation = self._restore_marketplace_package_generation(record, dest=dest)
            package_restored = True
            if record.get("state_before") is not None:
                self._restore_marketplace_state(
                    plugin_id,
                    plugin_kind=package_kind,
                    snapshot=record["state_before"],
                )
            if restore_permission:
                permission_store.restore(plugin_id, record.get("permission_before"))
                permission_restored = True
        except Exception:
            if permission_restored:
                with contextlib.suppress(Exception):
                    permission_store.restore(plugin_id, current_permission)
            if package_restored:
                with contextlib.suppress(Exception):
                    self._undo_marketplace_package_restore(record, dest=dest)
            if skills_restored:
                with contextlib.suppress(Exception):
                    self._undo_marketplace_skill_restore(
                        skills_payload,
                        plugin_id=plugin_id,
                        transaction_id=transaction_id,
                    )
            with contextlib.suppress(Exception):
                self._restore_marketplace_state(
                    plugin_id,
                    plugin_kind=package_kind,
                    snapshot=current_state,
                )
            raise
        return operation

    def _restore_marketplace_package_generation(
        self,
        record: dict[str, Any],
        *,
        dest: Path,
    ) -> str:
        transaction_id, plugin_id, package_kind = self._marketplace_transaction_identity(record)
        lifecycle = dest / ".lifecycle"
        target = dest / plugin_id
        backup = lifecycle / "backups" / transaction_id / plugin_id
        failed = lifecycle / "failed" / transaction_id / plugin_id
        trust_path = lifecycle / "trust" / f"{plugin_id}.json"
        previous_trust = backup.parent / "trust.json"
        failed_trust = failed.parent / "trust.json"
        if target.is_symlink() or backup.is_symlink() or failed.is_symlink():
            raise ValueError("refusing to restore symlinked marketplace package")
        if record.get("operation") == "update" and not backup.is_dir():
            raise ValueError("previous marketplace package generation is unavailable")
        if backup.is_dir() and record.get("rollback_candidate") is True:
            verify_marketplace_package_trust(
                backup,
                package_kind=package_kind,
                plugin_id=plugin_id,
                expected_version=str(record.get("previous_version") or "").strip() or None,
                require_trusted=not (_support.REPO / ".git").exists(),
            )
        if failed.parent.exists():
            raise FileExistsError(f"marketplace package rollback already staged: {transaction_id}")
        failed.parent.mkdir(parents=True, exist_ok=True)
        if trust_path.is_file():
            shutil.copy2(trust_path, failed_trust)
        if target.exists():
            target.replace(failed)
        try:
            if backup.is_dir():
                backup.replace(target)
                if previous_trust.is_file():
                    previous_trust.replace(trust_path)
                else:
                    with contextlib.suppress(OSError):
                        trust_path.unlink()
                operation = "restored_previous"
            else:
                with contextlib.suppress(OSError):
                    trust_path.unlink()
                operation = "removed_new_install"
        except Exception:
            if target.exists() and record.get("operation") == "update" and not backup.exists():
                backup.parent.mkdir(parents=True, exist_ok=True)
                target.replace(backup)
            if failed.exists():
                failed.replace(target)
            if failed_trust.is_file():
                failed_trust.replace(trust_path)
            raise
        return operation

    def _undo_marketplace_package_restore(
        self,
        record: dict[str, Any],
        *,
        dest: Path,
    ) -> None:
        transaction_id, plugin_id, _package_kind = self._marketplace_transaction_identity(record)
        lifecycle = dest / ".lifecycle"
        target = dest / plugin_id
        backup = lifecycle / "backups" / transaction_id / plugin_id
        failed = lifecycle / "failed" / transaction_id / plugin_id
        trust_path = lifecycle / "trust" / f"{plugin_id}.json"
        previous_trust = backup.parent / "trust.json"
        failed_trust = failed.parent / "trust.json"
        if record.get("operation") == "update" and target.is_dir():
            backup.parent.mkdir(parents=True, exist_ok=True)
            target.replace(backup)
            if trust_path.is_file():
                trust_path.replace(previous_trust)
        if failed.is_dir():
            failed.replace(target)
        if failed_trust.is_file():
            failed_trust.replace(trust_path)

    def _undo_marketplace_skill_restore(
        self,
        payload: Any,
        *,
        plugin_id: str,
        transaction_id: str,
    ) -> None:
        current_ids, previous_ids, current_registry, _previous_registry = (
            self._validated_marketplace_skill_generation(payload, plugin_id=plugin_id)
        )
        lifecycle = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id
        backup = lifecycle / "backup"
        failed = lifecycle / "failed"
        observed = self._bundled_skill_ids(plugin_id)
        if observed != previous_ids:
            raise ValueError("restored bundled skill generation was modified")
        for skill_id in sorted(previous_ids):
            backup.mkdir(parents=True, exist_ok=True)
            (self.SKILLS_ROOT / skill_id).replace(backup / skill_id)
        for skill_id in sorted(current_ids):
            candidate = failed / skill_id
            if not candidate.is_dir() or candidate.is_symlink():
                raise ValueError("failed bundled skill generation is unavailable")
            candidate.replace(self.SKILLS_ROOT / skill_id)
        registry = self._skill_registry()
        prefix = f"{plugin_id}__"
        other_registry = [
            row for row in registry if not str(row.get("name") or "").startswith(prefix)
        ]
        atomic_write_json(
            self.SKILLS_ROOT / "registry.json",
            [*other_registry, *current_registry],
            sort_keys=True,
        )
