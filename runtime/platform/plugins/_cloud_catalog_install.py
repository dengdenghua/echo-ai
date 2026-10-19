"""Plugin install, uninstall, and rollback flows for the cloud catalog.

Extracted from ``cloud_catalog`` to keep the module under the god-file
threshold. ``CloudCatalog`` mixes this in.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json
from runtime.platform.io.transactional import path_transaction
from runtime.platform.plugins import _cloud_catalog_support as _support
from runtime.platform.plugins._cloud_catalog_entries import _FACTORY_WORKBENCH_PLUGINS
from runtime.platform.plugins.marketplace_package import verify_marketplace_package_trust
from runtime.platform.plugins.workbench_package import WorkbenchPackageStore


class CloudCatalogInstallMixin:
    """Install/uninstall/rollback state machines for plugins and workbenches."""

    CODEX_CACHE_ROOT: Any
    _commit_marketplace_installed_state: Any
    _commit_marketplace_skill_generation: Any
    _invalidate_marketplace_transactions: Any
    _latest_marketplace_transaction: Any
    _latest_workbench_transaction: Any
    _marketplace_runtime_sources: Any
    _marketplace_state_snapshot: Any
    _marketplace_transaction_lock_path: Any
    _recover_incomplete_marketplace_transactions: Any
    _restore_marketplace_transaction_generations: Any
    _verify_marketplace_skill_projection: Any
    _workbench_activation_store: Any
    _workbench_data_store: Any
    _workbench_package_state_path: Any
    _write_marketplace_transaction: Any
    items: Any

    PLUGIN_INSTALL_ROOT: Any
    CAPABILITY_STATE_FILE: Any
    SKILLS_ROOT: Any
    _archive_path: Any
    _skill_archive_path: Any
    _extract_member: Any
    _accept_catalog: Any
    _load: Any
    _commit_workbench_package: Any
    _commit_marketplace_package: Any
    _abort_marketplace_transaction: Any
    _finalize_marketplace_transaction: Any
    _validate_marketplace_compatibility: Any
    _validate_workbench_compatibility: Any
    _copy_bundled_skills: Any
    _remove_bundled_skill_ids: Any
    _marketplace_state_payload: Any
    _marketplace_permission_store: Any
    _restore_marketplace_state: Any
    _marketplace_package_skill_sources: Any
    _recover_partial_marketplace_skill_generation: Any
    _mark_marketplace_package_uninstalled: Any
    _ensure_workbench_not_required: Any
    _rollback_dependency_installs: Any
    _version_is_newer: Any
    _workbench_package_state: Any

    def install_plugin(
        self,
        plugin_id: str,
        *,
        plugin_kind: str = "connector",
        dest_root: str | Path | None = None,
        enabled: bool = True,
        restore_data: bool = False,
        recovery_id: str | None = None,
        _dependency_chain: tuple[str, ...] = (),
    ) -> dict[str, Any]:
        if plugin_kind in {"connector", "codex"}:
            with path_transaction(self._marketplace_transaction_lock_path()):
                return self._install_plugin_unlocked(
                    plugin_id,
                    plugin_kind=plugin_kind,
                    dest_root=dest_root,
                    enabled=enabled,
                    restore_data=restore_data,
                    recovery_id=recovery_id,
                    _dependency_chain=_dependency_chain,
                )
        return self._install_plugin_unlocked(
            plugin_id,
            plugin_kind=plugin_kind,
            dest_root=dest_root,
            enabled=enabled,
            restore_data=restore_data,
            recovery_id=recovery_id,
            _dependency_chain=_dependency_chain,
        )

    def _install_plugin_unlocked(
        self,
        plugin_id: str,
        *,
        plugin_kind: str = "connector",
        dest_root: str | Path | None = None,
        enabled: bool = True,
        restore_data: bool = False,
        recovery_id: str | None = None,
        _dependency_chain: tuple[str, ...] = (),
    ) -> dict[str, Any]:
        """下载插件内容包,把 plugins/<kind>/<id> 落地 + 复制捆绑技能到本地技能库。"""
        if plugin_kind not in {"connector", "codex", "workbench"}:
            raise ValueError(f"unsupported cloud plugin kind: {plugin_kind}")
        if plugin_kind in {"connector", "codex"}:
            self._recover_incomplete_marketplace_transactions(plugin_kind=plugin_kind)
        if plugin_kind == "workbench" and plugin_id in _FACTORY_WORKBENCH_PLUGINS:
            state = self._workbench_activation_store().install(
                plugin_id,
                enabled=enabled,
                restore_data=restore_data,
                recovery_id=recovery_id,
            )
            return {
                **state,
                "plugin_id": plugin_id,
                "kind": plugin_kind,
                "path": state["factory_path"],
                "copied_skills": [],
                "source": "factory",
                "restart_required": True,
            }
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", plugin_id).strip("_") or "plugin"
        if safe in _dependency_chain:
            chain = " -> ".join((*_dependency_chain, safe))
            dependency_kind = "workbench" if plugin_kind == "workbench" else "marketplace"
            raise ValueError(f"cyclic {dependency_kind} dependency: {chain}")
        member_prefix = f"plugins/{plugin_kind}"
        dest = Path(dest_root or (self.PLUGIN_INSTALL_ROOT / plugin_kind))
        dest.mkdir(parents=True, exist_ok=True)
        target = dest / safe
        transaction: dict[str, Any] | None = None
        marketplace_trust: dict[str, Any] | None = None
        installed_dependencies: list[dict[str, Any]] = []
        with tempfile.TemporaryDirectory(prefix="echo-plugin-") as tmp:
            # Source checkouts normally exercise the same marketplace download
            # path as packaged builds. Opt in to local source packages only
            # when developing the packaging flow itself.
            dev_source = (
                _support.REPO / "extensions" / "workbench-apps" / safe
                if plugin_kind == "workbench"
                else _support.REPO / "extensions" / "codex-plugins" / safe
            )
            dev_install = (
                plugin_kind in {"workbench", "codex"}
                and (_support.REPO / ".git").exists()
                and dev_source.is_dir()
                and os.environ.get("ECHO_MARKETPLACE_DEV_SOURCES") == "1"
            )
            if dev_install:
                extracted = Path(tmp) / safe
                remote_backend = {
                    "narrative_studio": "narrative_studio",
                    "paper-trading": "paper_trading",
                }.get(safe)
                if plugin_kind == "workbench" and remote_backend:
                    backend_source = (
                        _support.REPO
                        / "runtime"
                        / "platform"
                        / "plugins"
                        / "bundled"
                        / remote_backend
                    )
                    if not backend_source.is_dir():
                        raise KeyError(f"{safe} runtime source is unavailable")
                    shutil.copytree(
                        backend_source,
                        extracted,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
                    )
                    shutil.copytree(dev_source, extracted, dirs_exist_ok=True)
                else:
                    shutil.copytree(dev_source, extracted)
            else:
                extracted = self._extract_member(
                    self._archive_path(), member_prefix, Path(tmp), safe
                )
            if extracted is None:
                raise KeyError(f"plugin not found in content pack: {plugin_id}")
            if any(child.is_symlink() for child in extracted.rglob("*")):
                raise ValueError(f"plugin contains symlinks: {plugin_id}")
            if plugin_kind == "workbench":
                candidate = WorkbenchPackageStore(extracted.parent).load_manifest(safe)
                try:
                    for dependency in candidate.dependencies:
                        dependency_path = dest / dependency
                        if dependency_path.is_dir():
                            WorkbenchPackageStore(
                                dest,
                                require_integrity=True,
                            ).load_manifest(dependency)
                            continue
                        dependency_item = next(
                            (
                                item
                                for item in self.items()
                                if item.get("kind") == "workbench"
                                and item.get("plugin") == dependency
                            ),
                            None,
                        )
                        if dependency_item is None:
                            raise KeyError(f"workbench dependency is unavailable: {dependency}")
                        dependency_result = self.install_plugin(
                            dependency,
                            plugin_kind="workbench",
                            enabled=True,
                            _dependency_chain=(*_dependency_chain, safe),
                        )
                        installed_dependencies.extend(
                            list(dependency_result.get("installed_dependencies") or [])
                        )
                        installed_dependencies.append(
                            {
                                "plugin_id": dependency,
                                "runtime_plugin": dependency_result.get("runtime_plugin"),
                                "transaction_id": dependency_result.get("transaction_id"),
                            }
                        )
                    transaction = self._commit_workbench_package(
                        extracted,
                        target=target,
                        dest=dest,
                        plugin_id=safe,
                        require_trusted=not dev_install,
                    )
                except Exception:
                    self._rollback_dependency_installs(installed_dependencies)
                    raise
            else:
                catalog_item = next(
                    (
                        item
                        for item in self.items()
                        if str(item.get("plugin") or item.get("id") or "") == safe
                    ),
                    None,
                )
                if catalog_item is None:
                    raise KeyError(f"plugin is missing from the trusted catalog: {plugin_id}")
                require_trusted = not (_support.REPO / ".git").exists()
                try:
                    # Resolve only declarations covered by this package's
                    # verified publisher signature. Missing dependencies are
                    # installed disabled, and every newly introduced
                    # generation is rolled back if the parent cannot commit.
                    candidate_trust = verify_marketplace_package_trust(
                        extracted,
                        package_kind=plugin_kind,
                        plugin_id=safe,
                        expected_version=str(catalog_item.get("version") or "").strip() or None,
                        require_trusted=require_trusted,
                    )
                    for dependency in candidate_trust.get("dependencies") or []:
                        dependency_id = str(dependency)
                        candidates = (
                            (
                                "codex",
                                self.PLUGIN_INSTALL_ROOT / "codex" / dependency_id,
                            ),
                            ("codex", self.CODEX_CACHE_ROOT / dependency_id),
                            (
                                "connector",
                                self.PLUGIN_INSTALL_ROOT / "connector" / dependency_id,
                            ),
                        )
                        ready = False
                        for dependency_kind, dependency_path in candidates:
                            if not dependency_path.is_dir() or dependency_path.is_symlink():
                                continue
                            try:
                                verify_marketplace_package_trust(
                                    dependency_path,
                                    package_kind=dependency_kind,
                                    plugin_id=dependency_id,
                                    require_trusted=require_trusted,
                                )
                            except (FileNotFoundError, ValueError):
                                continue
                            ready = True
                            break
                        if ready:
                            continue
                        dependency_item = next(
                            (
                                item
                                for item in self.items()
                                if str(item.get("plugin") or item.get("id") or "") == dependency_id
                                and item.get("kind") in {"plugin", "connector"}
                            ),
                            None,
                        )
                        if dependency_item is None:
                            raise KeyError(
                                f"marketplace dependency is unavailable: {dependency_id}"
                            )
                        dependency_kind = (
                            "codex" if dependency_item.get("kind") == "plugin" else "connector"
                        )
                        dependency_result = self.install_plugin(
                            dependency_id,
                            plugin_kind=dependency_kind,
                            _dependency_chain=(*_dependency_chain, safe),
                        )
                        installed_dependencies.extend(
                            list(dependency_result.get("installed_dependencies") or [])
                        )
                        installed_dependencies.append(
                            {
                                "plugin_id": dependency_id,
                                "kind": dependency_kind,
                                "transaction_id": dependency_result.get("transaction_id"),
                            }
                        )
                    transaction = self._commit_marketplace_package(
                        extracted,
                        target=target,
                        dest=dest,
                        plugin_id=safe,
                        package_kind=plugin_kind,
                        expected_version=str(catalog_item.get("version") or "").strip() or None,
                        require_trusted=require_trusted,
                    )
                    marketplace_trust = transaction["trust"]
                except Exception:
                    self._rollback_dependency_installs(installed_dependencies)
                    raise
        marketplace_transaction = transaction if plugin_kind in {"codex", "connector"} else None
        if marketplace_transaction is not None:
            try:
                state_before = self._marketplace_state_snapshot(
                    safe,
                    plugin_kind=plugin_kind,
                )
                permission_store = self._marketplace_permission_store()
                permission_before = permission_store.snapshot(safe)
                skill_generation = self._commit_marketplace_skill_generation(
                    target,
                    plugin_id=safe,
                    transaction_id=str(marketplace_transaction["transaction_id"]),
                )
                self._verify_marketplace_skill_projection(
                    target,
                    plugin_id=safe,
                )
                marketplace_transaction.update(
                    {
                        "skills": skill_generation,
                        "state_before": state_before,
                        "permission_before": permission_before,
                        "status": "skills_committed",
                    }
                )
                self._write_marketplace_transaction(marketplace_transaction, dest=dest)
                self._commit_marketplace_installed_state(
                    safe,
                    plugin_kind=plugin_kind,
                    previous=state_before,
                )
                permission_store.stage(
                    safe,
                    kind=plugin_kind,
                    required=(marketplace_transaction.get("trust") or {}).get("permissions", []),
                    manifest_digest=str(
                        (marketplace_transaction.get("trust") or {}).get("content_digest", "")
                    ),
                    runtime_sources=self._marketplace_runtime_sources(
                        target,
                        plugin_id=safe,
                        plugin_kind=plugin_kind,
                    ),
                )
                marketplace_transaction.update(
                    {
                        "status": "committed",
                        "rollback_available": marketplace_transaction.get("rollback_candidate")
                        is True,
                    }
                )
                self._write_marketplace_transaction(marketplace_transaction, dest=dest)
            except Exception:
                self._abort_marketplace_transaction(marketplace_transaction, dest=dest)
                raise
            self._finalize_marketplace_transaction(marketplace_transaction, dest=dest)
            copied = list(skill_generation["skill_ids"])
        else:
            copied = self._copy_bundled_skills(target, safe)
        data_result: dict[str, Any] | None = None
        runtime_plugin: str | None = None
        if plugin_kind == "workbench":
            manifest = WorkbenchPackageStore(dest).load_manifest(safe)
            runtime_plugin = manifest.runtime_plugin
            if restore_data:
                try:
                    data_result = self._workbench_data_store().restore(
                        safe,
                        manifest.data_paths,
                        recovery_id=recovery_id,
                    )
                except Exception:
                    if transaction is not None:
                        self.rollback_plugin(
                            safe,
                            plugin_kind="workbench",
                            transaction_id=str(transaction["transaction_id"]),
                        )
                    raise
            state = self._workbench_package_state()
            state[safe] = bool(enabled)
            atomic_write_json(self._workbench_package_state_path(), state, sort_keys=True)
        return {
            "installed": True,
            "plugin_id": plugin_id,
            "kind": plugin_kind,
            "path": str(target),
            "copied_skills": copied,
            "source": "cloud",
            "restart_required": False if plugin_kind == "workbench" else None,
            "runtime_plugin": runtime_plugin,
            "operation": transaction.get("operation") if transaction else "install",
            "transaction_id": transaction.get("transaction_id") if transaction else None,
            "rollback_available": bool(transaction and transaction.get("rollback_available")),
            "trust": transaction.get("trust") if transaction else marketplace_trust,
            "data": data_result,
            "recoveries": self._workbench_data_store().recoveries(safe)
            if plugin_kind == "workbench"
            else [],
            "installed_dependencies": installed_dependencies,
        }

    def uninstall_plugin(
        self,
        plugin_id: str,
        *,
        plugin_kind: str = "connector",
        data_policy: str = "keep",
        confirm_data_move: bool = False,
    ) -> dict[str, Any]:
        if plugin_kind in {"connector", "codex"}:
            with path_transaction(self._marketplace_transaction_lock_path()):
                self._recover_incomplete_marketplace_transactions(plugin_kind=plugin_kind)
                return self._uninstall_plugin_unlocked(
                    plugin_id,
                    plugin_kind=plugin_kind,
                    data_policy=data_policy,
                    confirm_data_move=confirm_data_move,
                )
        return self._uninstall_plugin_unlocked(
            plugin_id,
            plugin_kind=plugin_kind,
            data_policy=data_policy,
            confirm_data_move=confirm_data_move,
        )

    def _uninstall_plugin_unlocked(
        self,
        plugin_id: str,
        *,
        plugin_kind: str = "connector",
        data_policy: str = "keep",
        confirm_data_move: bool = False,
    ) -> dict[str, Any]:
        """Remove one mutable cloud package and its copied skills.

        The target is always resolved below ``PLUGIN_INSTALL_ROOT``; bundled
        runtime plugins and application source directories cannot be removed
        through this method.
        """
        if plugin_kind not in {"connector", "codex", "workbench"}:
            raise ValueError(f"unsupported cloud plugin kind: {plugin_kind}")
        if plugin_kind == "workbench" and plugin_id in _FACTORY_WORKBENCH_PLUGINS:
            state = self._workbench_activation_store().uninstall(
                plugin_id,
                data_policy=data_policy,
                confirm_data_move=confirm_data_move,
            )
            return {
                **state,
                "plugin_id": plugin_id,
                "kind": plugin_kind,
                "removed_skills": [],
                "source": "factory",
                "restart_required": True,
            }
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", plugin_id).strip("_") or "plugin"
        kind_root = (self.PLUGIN_INSTALL_ROOT / plugin_kind).resolve()
        target = (kind_root / safe).resolve()
        if kind_root not in target.parents:
            raise ValueError(f"unsafe plugin id: {plugin_id}")
        if not target.is_dir():
            raise KeyError(f"cloud plugin is not installed: {plugin_id}")
        data_result: dict[str, Any] = {"status": "kept", "paths": []}
        manifest = None
        runtime_plugin: str | None = None
        if plugin_kind == "workbench":
            if data_policy not in {"keep", "trash"}:
                raise ValueError("data_policy must be 'keep' or 'trash'")
            self._ensure_workbench_not_required(safe)
            try:
                manifest = WorkbenchPackageStore(kind_root).load_manifest(safe)
                runtime_plugin = manifest.runtime_plugin
            except (FileNotFoundError, ValueError):
                # Broken packages remain removable with the safe keep policy.
                # The caller may already know the runtime id from its catalog
                # descriptor, but untrusted/broken manifest data is ignored.
                manifest = None
            if data_policy == "trash":
                # A broken package must remain removable with the safe default
                # keep policy. Moving declared data is different: it requires a
                # valid signed/validated manifest so an attacker cannot name an
                # arbitrary application-data path.
                manifest = WorkbenchPackageStore(kind_root).load_manifest(safe)
                runtime_plugin = manifest.runtime_plugin
                data_result = self._workbench_data_store().trash(
                    safe,
                    manifest.data_paths,
                    confirm=confirm_data_move,
                )
        try:
            shutil.rmtree(target)
        except Exception:
            if data_result.get("status") == "trashed" and manifest is not None:
                self._workbench_data_store().restore(
                    safe,
                    manifest.data_paths,
                    recovery_id=str(data_result["recovery_id"]),
                )
            raise
        trust_path = kind_root / ".lifecycle" / "trust" / f"{safe}.json"
        with contextlib.suppress(OSError):
            trust_path.unlink()
        if plugin_kind == "workbench":
            state = self._workbench_package_state()
            state.pop(safe, None)
            atomic_write_json(self._workbench_package_state_path(), state, sort_keys=True)

        removed_skills: list[str] = []
        if self.SKILLS_ROOT.is_dir():
            prefix = f"{safe}__"
            for skill_dir in self.SKILLS_ROOT.iterdir():
                if skill_dir.is_dir() and skill_dir.name.startswith(prefix):
                    shutil.rmtree(skill_dir)
                    removed_skills.append(skill_dir.name)
        registry_path = self.SKILLS_ROOT / "registry.json"
        if registry_path.exists() and removed_skills:
            try:
                registry = json.loads(registry_path.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                registry = []
            if isinstance(registry, list):
                registry = [
                    entry
                    for entry in registry
                    if not isinstance(entry, dict)
                    or str(entry.get("name") or "") not in removed_skills
                ]
                atomic_write_json(registry_path, registry, sort_keys=True)

        if plugin_kind in {"connector", "codex"}:
            self._mark_marketplace_package_uninstalled(safe, plugin_kind=plugin_kind)
            self._invalidate_marketplace_transactions(safe, plugin_kind=plugin_kind)
            self._marketplace_permission_store().mark_uninstalled(safe)
        return {
            "uninstalled": True,
            "plugin_id": plugin_id,
            "kind": plugin_kind,
            "removed_skills": sorted(removed_skills),
            "data_policy": data_policy if plugin_kind == "workbench" else None,
            "data": data_result,
            "runtime_plugin": runtime_plugin,
            "recoveries": self._workbench_data_store().recoveries(safe)
            if plugin_kind == "workbench"
            else [],
        }

    def rollback_plugin(
        self,
        plugin_id: str,
        *,
        plugin_kind: str = "workbench",
        transaction_id: str | None = None,
    ) -> dict[str, Any]:
        """Atomically restore the package generation replaced by a transaction."""

        if plugin_kind in {"codex", "connector"}:
            with path_transaction(self._marketplace_transaction_lock_path()):
                return self._rollback_marketplace_package(
                    plugin_id,
                    plugin_kind=plugin_kind,
                    transaction_id=transaction_id,
                )
        if plugin_kind != "workbench":
            raise ValueError("rollback is unsupported for this package kind")
        safe = WorkbenchPackageStore.validate_id(plugin_id)
        dest = (self.PLUGIN_INSTALL_ROOT / "workbench").resolve()
        lifecycle = dest / ".lifecycle"
        transactions = lifecycle / "transactions"
        if transaction_id is None:
            latest = self._latest_workbench_transaction(safe)
            if latest is None:
                raise KeyError(f"no rollback transaction found: {safe}")
            transaction_path = transactions / f"{latest['transaction_id']}.json"
        else:
            if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
                raise ValueError("invalid transaction_id")
            transaction_path = transactions / f"{transaction_id}.json"
        try:
            record = json.loads(transaction_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise KeyError(f"rollback transaction is unavailable: {safe}") from exc
        if (
            not isinstance(record, dict)
            or record.get("plugin_id") != safe
            or record.get("status") != "committed"
        ):
            raise ValueError("rollback transaction is invalid or already consumed")

        target = dest / safe
        backup_text = str(record.get("backup") or "")
        backup = Path(backup_text).resolve() if backup_text else None
        failed = lifecycle / "failed" / str(record["transaction_id"]) / safe
        trust_path = lifecycle / "trust" / f"{safe}.json"
        previous_trust = backup.parent / "trust.json" if backup is not None else None
        if target.is_symlink() or (backup is not None and backup.is_symlink()):
            raise ValueError("refusing to rollback symlinked workbench package")
        failed.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            target.replace(failed)
        try:
            if backup is not None and backup.is_dir():
                backup.replace(target)
                restored = WorkbenchPackageStore(dest).load_manifest(safe)
                if previous_trust is not None and previous_trust.is_file():
                    trust_path.parent.mkdir(parents=True, exist_ok=True)
                    previous_trust.replace(trust_path)
                else:
                    with contextlib.suppress(OSError):
                        trust_path.unlink()
                runtime_plugin = restored.runtime_plugin
                operation = "restored_previous"
            else:
                with contextlib.suppress(OSError):
                    trust_path.unlink()
                runtime_plugin = None
                operation = "removed_new_install"
        except Exception:
            if failed.exists() and not target.exists():
                failed.replace(target)
            raise
        record.update(
            {
                "status": "rolled_back",
                "rolled_back_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "failed_generation": str(failed) if failed.exists() else None,
            }
        )
        atomic_write_json(transaction_path, record, sort_keys=True)
        return {
            "ok": True,
            "plugin_id": safe,
            "kind": plugin_kind,
            "transaction_id": record["transaction_id"],
            "operation": operation,
            "installed": target.is_dir(),
            "runtime_plugin": runtime_plugin,
            "path": str(target) if target.is_dir() else None,
        }

    def _rollback_marketplace_package(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
        transaction_id: str | None,
    ) -> dict[str, Any]:
        safe = WorkbenchPackageStore.validate_id(plugin_id)
        dest = (self.PLUGIN_INSTALL_ROOT / plugin_kind).resolve()
        lifecycle = dest / ".lifecycle"
        transactions = lifecycle / "transactions"
        if transaction_id is None:
            latest = self._latest_marketplace_transaction(safe, plugin_kind=plugin_kind)
            if latest is None:
                raise KeyError(f"no rollback transaction found: {safe}")
            transaction_id = str(latest["transaction_id"])
        if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
            raise ValueError("invalid transaction_id")
        transaction_path = transactions / f"{transaction_id}.json"
        try:
            record = json.loads(transaction_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise KeyError(f"rollback transaction is unavailable: {safe}") from exc
        if (
            not isinstance(record, dict)
            or record.get("schema") != "echo.marketplace_package_transaction.v1"
            or record.get("plugin_id") != safe
            or record.get("kind") != plugin_kind
            or record.get("status") != "committed"
            or record.get("rollback_available") is not True
        ):
            raise ValueError("rollback transaction is invalid, unavailable, or already consumed")

        target = dest / safe
        operation = self._restore_marketplace_transaction_generations(record, dest=dest)
        failed = lifecycle / "failed" / transaction_id / safe
        failed_skills = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id / "failed"
        record.update(
            {
                "status": "rolled_back",
                "rolled_back_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "failed_generation": str(failed) if failed.exists() else None,
                "failed_skill_generation": str(failed_skills) if failed_skills.exists() else None,
                "rollback_available": False,
            }
        )
        atomic_write_json(transaction_path, record, sort_keys=True)
        return {
            "ok": True,
            "plugin_id": safe,
            "kind": plugin_kind,
            "transaction_id": transaction_id,
            "operation": operation,
            "installed": target.is_dir(),
            "path": str(target) if target.is_dir() else None,
        }
