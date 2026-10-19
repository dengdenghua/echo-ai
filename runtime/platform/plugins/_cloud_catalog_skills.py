"""Marketplace skill projections and installed-state bookkeeping.

Extracted from ``cloud_catalog`` to keep the module under the god-file
threshold. ``CloudCatalog`` mixes this in.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json
from runtime.platform.plugins.marketplace_package import (
    compute_marketplace_content_provenance,
)


class CloudCatalogSkillsMixin:
    """Skill registry/projection plus marketplace installed-state commits."""

    CONNECTOR_STATE_FILE: Any
    _slug: Any

    SKILLS_ROOT: Any
    CAPABILITY_STATE_FILE: Any
    PLUGIN_INSTALL_ROOT: Any
    _load: Any
    _accept_catalog: Any
    _skill_archive_path: Any
    _extract_member: Any
    _bundled_skill_ids: Any
    _copy_bundled_skills: Any
    _remove_bundled_skill_ids: Any

    def _skill_registry(self) -> list[dict[str, Any]]:
        path = self.SKILLS_ROOT / "registry.json"
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("skill registry is invalid") from exc
        if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
            raise ValueError("skill registry is invalid")
        return payload

    @staticmethod
    def _marketplace_skill_record(plugin_id: str, skill_id: str) -> dict[str, Any]:
        return {
            "name": skill_id,
            "version": "0.1.0",
            "author": f"cloud-plugin:{plugin_id}",
            "description": f"云插件 {plugin_id} 捆绑技能",
            "tags": [plugin_id, "cloud"],
            "source": "cloud",
        }

    def _commit_marketplace_skill_generation(
        self,
        plugin_dir: Path,
        *,
        plugin_id: str,
        transaction_id: str,
    ) -> dict[str, Any]:
        """Atomically replace the plugin-owned skill namespace."""

        if not re.fullmatch(r"[a-f0-9]{32}", transaction_id):
            raise ValueError("invalid transaction_id")
        self.SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
        lifecycle = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id
        staging = lifecycle / "staging"
        backup = lifecycle / "backup"
        if lifecycle.exists():
            raise FileExistsError(f"marketplace skill transaction already exists: {transaction_id}")
        desired: dict[str, Path] = {}
        skills_dir = plugin_dir / "skills"
        if skills_dir.is_dir():
            for skill_md in sorted(skills_dir.rglob("SKILL.md")):
                skill_id = self._slug(f"{plugin_id}__{skill_md.parent.name}")
                if skill_id in desired:
                    raise ValueError(f"duplicate bundled skill identity: {skill_id}")
                desired[skill_id] = skill_md.parent
                if len(desired) > 256:
                    raise ValueError("marketplace package contains too many bundled skills")
        previous_ids = self._bundled_skill_ids(plugin_id)
        for skill_id in previous_ids:
            candidate = self.SKILLS_ROOT / skill_id
            if candidate.is_symlink():
                raise ValueError(f"bundled skill target cannot be a symlink: {skill_id}")
        registry = self._skill_registry()
        prefix = f"{plugin_id}__"
        previous_registry = [
            dict(row) for row in registry if str(row.get("name") or "").startswith(prefix)
        ]
        previous_registry_ids = [str(row.get("name") or "") for row in previous_registry]
        if set(previous_registry_ids) != previous_ids or len(previous_registry_ids) != len(
            previous_ids
        ):
            raise ValueError("bundled skill registry does not match installed skill directories")
        other_registry = [
            row for row in registry if not str(row.get("name") or "").startswith(prefix)
        ]
        desired_registry = [
            self._marketplace_skill_record(plugin_id, skill_id) for skill_id in sorted(desired)
        ]
        generation = {
            "schema": "echo.marketplace_skill_generation.v1",
            "skill_ids": sorted(desired),
            "previous_skill_ids": sorted(previous_ids),
            "registry_entries": desired_registry,
            "previous_registry_entries": previous_registry,
        }
        try:
            lifecycle.mkdir(parents=True, exist_ok=False)
            atomic_write_json(lifecycle / "generation.json", generation, sort_keys=True)
            staging.mkdir(parents=True, exist_ok=False)
            for skill_id, source in desired.items():
                target = staging / skill_id
                shutil.copytree(source, target)
                meta_path = target / "meta.json"
                if not meta_path.exists():
                    meta_path.write_text(
                        json.dumps(
                            {
                                "name": skill_id,
                                "author": f"cloud-plugin:{plugin_id}",
                                "source": "cloud",
                            },
                            ensure_ascii=False,
                            indent=2,
                            sort_keys=True,
                        )
                        + "\n",
                        encoding="utf-8",
                    )
            if previous_ids:
                backup.mkdir(parents=True, exist_ok=False)
                for skill_id in sorted(previous_ids):
                    (self.SKILLS_ROOT / skill_id).replace(backup / skill_id)
            for skill_id in sorted(desired):
                (staging / skill_id).replace(self.SKILLS_ROOT / skill_id)
            atomic_write_json(
                self.SKILLS_ROOT / "registry.json",
                [*other_registry, *desired_registry],
                sort_keys=True,
            )
        except Exception:
            for skill_id in sorted(desired):
                current = self.SKILLS_ROOT / skill_id
                if current.is_dir() and not current.is_symlink():
                    shutil.rmtree(current)
            if backup.is_dir():
                for previous in sorted(backup.iterdir()):
                    previous.replace(self.SKILLS_ROOT / previous.name)
            shutil.rmtree(lifecycle, ignore_errors=True)
            raise
        shutil.rmtree(staging, ignore_errors=True)
        return generation

    @staticmethod
    def _validated_marketplace_skill_generation(
        payload: Any,
        *,
        plugin_id: str,
    ) -> tuple[set[str], set[str], list[dict[str, Any]], list[dict[str, Any]]]:
        if not isinstance(payload, dict) or payload.get("schema") != (
            "echo.marketplace_skill_generation.v1"
        ):
            raise ValueError("marketplace skill generation is invalid")
        prefix = f"{plugin_id}__"

        def ids(field: str) -> set[str]:
            rows = payload.get(field)
            if (
                not isinstance(rows, list)
                or len(rows) > 256
                or any(
                    not isinstance(row, str)
                    or not row.startswith(prefix)
                    or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,255}", row)
                    for row in rows
                )
                or len(set(rows)) != len(rows)
            ):
                raise ValueError("marketplace skill generation ids are invalid")
            return set(rows)

        def entries(field: str, expected: set[str]) -> list[dict[str, Any]]:
            rows = payload.get(field)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("marketplace skill registry generation is invalid")
            names = [str(row.get("name") or "") for row in rows]
            if set(names) != expected or len(names) != len(expected):
                raise ValueError("marketplace skill registry generation does not match skills")
            return [dict(row) for row in rows]

        current_ids = ids("skill_ids")
        previous_ids = ids("previous_skill_ids")
        return (
            current_ids,
            previous_ids,
            entries("registry_entries", current_ids),
            entries("previous_registry_entries", previous_ids),
        )

    def _marketplace_package_skill_sources(
        self,
        package_dir: Path,
        *,
        plugin_id: str,
    ) -> dict[str, Path]:
        sources: dict[str, Path] = {}
        skills_dir = package_dir / "skills"
        if not skills_dir.is_dir():
            return sources
        for skill_md in sorted(skills_dir.rglob("SKILL.md")):
            skill_id = self._slug(f"{plugin_id}__{skill_md.parent.name}")
            if skill_id in sources:
                raise ValueError(f"duplicate bundled skill identity: {skill_id}")
            sources[skill_id] = skill_md.parent
            if len(sources) > 256:
                raise ValueError("marketplace package contains too many bundled skills")
        return sources

    def _verify_marketplace_skill_projection(
        self,
        package_dir: Path,
        *,
        plugin_id: str,
        skills_container: Path | None = None,
        registry_entries: list[dict[str, Any]] | None = None,
    ) -> None:
        expected = self._marketplace_package_skill_sources(
            package_dir,
            plugin_id=plugin_id,
        )
        container = skills_container or self.SKILLS_ROOT
        prefix = f"{plugin_id}__"
        if container.is_dir():
            observed = {
                candidate.name
                for candidate in container.iterdir()
                if candidate.is_dir() and candidate.name.startswith(prefix)
            }
        else:
            observed = set()
        if observed != set(expected):
            raise ValueError("bundled skill projection does not match signed package")
        for skill_id, source in expected.items():
            projected = container / skill_id
            source_meta = source / "meta.json"
            if source_meta.is_file():
                ignored_path = Path(".echo-no-signature")
            else:
                ignored_path = Path("meta.json")
                try:
                    projected_meta = json.loads(
                        (projected / "meta.json").read_text(encoding="utf-8")
                    )
                except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ValueError(f"bundled skill metadata is invalid: {skill_id}") from exc
                if projected_meta != {
                    "name": skill_id,
                    "author": f"cloud-plugin:{plugin_id}",
                    "source": "cloud",
                }:
                    raise ValueError(f"bundled skill metadata is invalid: {skill_id}")
            source_provenance = compute_marketplace_content_provenance(
                source,
                signature_relative_path=ignored_path,
            )
            projected_provenance = compute_marketplace_content_provenance(
                projected,
                signature_relative_path=ignored_path,
            )
            if (
                source_provenance.get("complete") is not True
                or projected_provenance.get("complete") is not True
                or source_provenance.get("digest") != projected_provenance.get("digest")
            ):
                raise ValueError(f"bundled skill projection integrity failed: {skill_id}")
        expected_registry = [
            self._marketplace_skill_record(plugin_id, skill_id) for skill_id in sorted(expected)
        ]
        if registry_entries is None:
            registry_entries = [
                dict(row)
                for row in self._skill_registry()
                if str(row.get("name") or "").startswith(prefix)
            ]
        if registry_entries != expected_registry:
            raise ValueError("bundled skill registry does not match signed package")

    def _restore_marketplace_skill_generation(
        self,
        payload: Any,
        *,
        plugin_id: str,
        transaction_id: str,
        keep_failed: bool,
    ) -> None:
        current_ids, previous_ids, _current_registry, previous_registry = (
            self._validated_marketplace_skill_generation(payload, plugin_id=plugin_id)
        )
        observed = self._bundled_skill_ids(plugin_id)
        if observed != current_ids:
            raise ValueError("installed bundled skill generation was modified")
        lifecycle = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id
        backup = lifecycle / "backup"
        failed = lifecycle / "failed"
        if any((self.SKILLS_ROOT / skill_id).is_symlink() for skill_id in current_ids):
            raise ValueError("refusing to rollback symlinked bundled skill")
        if any((backup / skill_id).is_symlink() for skill_id in previous_ids):
            raise ValueError("refusing to restore symlinked bundled skill")
        if previous_ids and (
            not backup.is_dir()
            or {path.name for path in backup.iterdir() if path.is_dir()} != previous_ids
        ):
            raise ValueError("previous bundled skill generation is unavailable")
        registry = self._skill_registry()
        prefix = f"{plugin_id}__"
        other_registry = [
            row for row in registry if not str(row.get("name") or "").startswith(prefix)
        ]
        if failed.exists():
            raise FileExistsError(f"marketplace skill rollback already staged: {transaction_id}")
        try:
            if current_ids:
                failed.mkdir(parents=True, exist_ok=False)
                for skill_id in sorted(current_ids):
                    (self.SKILLS_ROOT / skill_id).replace(failed / skill_id)
            if previous_ids:
                for skill_id in sorted(previous_ids):
                    (backup / skill_id).replace(self.SKILLS_ROOT / skill_id)
            atomic_write_json(
                self.SKILLS_ROOT / "registry.json",
                [*other_registry, *previous_registry],
                sort_keys=True,
            )
        except Exception:
            for skill_id in sorted(previous_ids):
                restored = self.SKILLS_ROOT / skill_id
                if restored.is_dir() and not restored.is_symlink():
                    backup.mkdir(parents=True, exist_ok=True)
                    restored.replace(backup / skill_id)
            if failed.is_dir():
                for skill_id in sorted(current_ids):
                    candidate = failed / skill_id
                    if candidate.is_dir():
                        candidate.replace(self.SKILLS_ROOT / skill_id)
            raise
        if not keep_failed:
            shutil.rmtree(lifecycle, ignore_errors=True)

    def _recover_partial_marketplace_skill_generation(
        self,
        payload: Any,
        *,
        plugin_id: str,
        transaction_id: str,
    ) -> None:
        current_ids, previous_ids, _current_registry, previous_registry = (
            self._validated_marketplace_skill_generation(payload, plugin_id=plugin_id)
        )
        lifecycle = self.SKILLS_ROOT / ".lifecycle" / "marketplace" / transaction_id
        backup = lifecycle / "backup"
        failed = lifecycle / "failed"
        failed.mkdir(parents=True, exist_ok=True)
        for skill_id in sorted(current_ids - previous_ids):
            current = self.SKILLS_ROOT / skill_id
            if current.is_symlink():
                raise ValueError("refusing to recover symlinked bundled skill")
            if current.is_dir():
                current.replace(failed / skill_id)
        for skill_id in sorted(previous_ids):
            previous = backup / skill_id
            current = self.SKILLS_ROOT / skill_id
            if previous.is_symlink() or current.is_symlink():
                raise ValueError("refusing to recover symlinked bundled skill")
            if previous.is_dir():
                if current.is_dir():
                    current.replace(failed / skill_id)
                previous.replace(current)
            elif not current.is_dir():
                raise ValueError("partial bundled skill transaction lost previous generation")
        registry = self._skill_registry()
        prefix = f"{plugin_id}__"
        other_registry = [
            row for row in registry if not str(row.get("name") or "").startswith(prefix)
        ]
        atomic_write_json(
            self.SKILLS_ROOT / "registry.json",
            [*other_registry, *previous_registry],
            sort_keys=True,
        )

    def _marketplace_state_payload(self, *, plugin_kind: str) -> dict[str, Any]:
        path = (
            self.CONNECTOR_STATE_FILE
            if plugin_kind == "connector"
            else self.CAPABILITY_STATE_FILE
            if plugin_kind == "codex"
            else None
        )
        if path is None:
            raise ValueError(f"unsupported marketplace package kind: {plugin_kind}")
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"{plugin_kind} state is invalid") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"{plugin_kind} state is invalid")
        return payload

    def _marketplace_package_enabled(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
    ) -> bool:
        try:
            payload = self._marketplace_state_payload(plugin_kind=plugin_kind)
        except ValueError:
            return False
        row = payload.get(plugin_id)
        if isinstance(row, dict) and isinstance(row.get("enabled"), bool):
            return bool(row["enabled"])
        return False

    def _marketplace_state_snapshot(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
    ) -> dict[str, Any]:
        payload = self._marketplace_state_payload(plugin_kind=plugin_kind)
        present = plugin_id in payload
        row = payload.get(plugin_id)
        if present and not isinstance(row, dict):
            raise ValueError(f"{plugin_kind} package state row is invalid: {plugin_id}")
        return {
            "schema": "echo.marketplace_state_snapshot.v1",
            "present": present,
            "row": dict(row) if isinstance(row, dict) else None,
        }

    def _commit_marketplace_installed_state(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
        previous: dict[str, Any],
    ) -> None:
        payload = self._marketplace_state_payload(plugin_kind=plugin_kind)
        previous_row = previous.get("row") if previous.get("present") is True else None
        if previous_row is not None and not isinstance(previous_row, dict):
            raise ValueError("marketplace state snapshot is invalid")
        row = dict(previous_row or {})
        row.update(
            id=plugin_id,
            installed=True,
            source="cloud",
        )
        if not isinstance(row.get("enabled"), bool):
            row["enabled"] = False
        payload[plugin_id] = row
        path = (
            self.CONNECTOR_STATE_FILE if plugin_kind == "connector" else self.CAPABILITY_STATE_FILE
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(path, payload, sort_keys=True)

    def _marketplace_permission_store(self) -> Any:
        from runtime.platform.capabilities.permission_grants import (
            CapabilityPermissionStore,
        )

        return CapabilityPermissionStore(
            self.CAPABILITY_STATE_FILE.parent / "permission-grants.json"
        )

    @staticmethod
    def _marketplace_runtime_sources(
        package_path: Path,
        *,
        plugin_id: str,
        plugin_kind: str,
    ) -> list[str]:
        sources = [f"plugin://{plugin_id}/"] if plugin_kind == "codex" else []
        for filename in ("mcp.json", ".mcp.json"):
            path = package_path / filename
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            servers = payload.get("mcpServers") if isinstance(payload, dict) else None
            if not isinstance(servers, dict):
                continue
            for server in sorted(servers):
                if isinstance(server, str) and server.strip():
                    sources.append(f"mcp://{server.strip()}/")
        return sorted(set(sources))

    def _restore_marketplace_state(
        self,
        plugin_id: str,
        *,
        plugin_kind: str,
        snapshot: Any,
    ) -> None:
        if (
            not isinstance(snapshot, dict)
            or snapshot.get("schema") != "echo.marketplace_state_snapshot.v1"
            or not isinstance(snapshot.get("present"), bool)
            or (snapshot.get("present") is True and not isinstance(snapshot.get("row"), dict))
            or (snapshot.get("present") is False and snapshot.get("row") is not None)
        ):
            raise ValueError("marketplace state snapshot is invalid")
        payload = self._marketplace_state_payload(plugin_kind=plugin_kind)
        if snapshot["present"]:
            if payload.get(plugin_id) == snapshot["row"]:
                return
            payload[plugin_id] = dict(snapshot["row"])
        else:
            if plugin_id not in payload:
                return
            payload.pop(plugin_id, None)
        path = (
            self.CONNECTOR_STATE_FILE if plugin_kind == "connector" else self.CAPABILITY_STATE_FILE
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(path, payload, sort_keys=True)
