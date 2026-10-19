"""云商城插件/技能目录源 —— 读发布到 GitHub Pages 的 plugin-store.json / skill-registry.json。

与 CloudExpertStore(专家)同构:远程 GitHub Pages 数据 + 本地镜像回退 + 磁盘缓存。
发布链路(把我们本地插件/技能带上云):
  extensions/workbuddy-experts/scripts/build-plugin-store.py   → plugin-store.json
  extensions/workbuddy-experts/scripts/build-skill-registry.py → skill-registry.json
  extensions/workbuddy-experts/scripts/publish-cloud.py        → 推到 gh-pages
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Any

from runtime.platform.io import atomic_write_json
from runtime.platform.io.transactional import path_transaction
from runtime.platform.plugins import _cloud_catalog_support as _support
from runtime.platform.plugins._cloud_catalog_entries import (
    _FACTORY_WORKBENCH_APPS_BY_ID as _FACTORY_WORKBENCH_APPS_BY_ID,
)
from runtime.platform.plugins._cloud_catalog_entries import (
    _FACTORY_WORKBENCH_PLUGINS as _FACTORY_WORKBENCH_PLUGINS,
)
from runtime.platform.plugins._cloud_catalog_entries import (
    _REMOTE_SURFACE_PLUGINS as _REMOTE_SURFACE_PLUGINS,
)
from runtime.platform.plugins._cloud_catalog_entries import (
    _WORKBENCH_APPS as _WORKBENCH_APPS,
)
from runtime.platform.plugins._cloud_catalog_install import (
    CloudCatalogInstallMixin,
)
from runtime.platform.plugins._cloud_catalog_skills import (
    CloudCatalogSkillsMixin,
)
from runtime.platform.plugins._cloud_catalog_support import (
    _MAX_ARCHIVE_BYTES,
    _MAX_ARCHIVE_MEMBERS,
    _MAX_CATALOG_BYTES,
    _MAX_EXTRACTED_BYTES,
    _MAX_MEMBER_BYTES,
    _download_content_pack,
)
from runtime.platform.plugins._cloud_catalog_support import (
    CACHE_DIR as CACHE_DIR,
)
from runtime.platform.plugins._cloud_catalog_support import (
    HOST_API_VERSION as HOST_API_VERSION,
)
from runtime.platform.plugins._cloud_catalog_support import (
    LOCAL_MIRROR_DIR as LOCAL_MIRROR_DIR,
)
from runtime.platform.plugins._cloud_catalog_support import REPO as REPO
from runtime.platform.plugins._cloud_catalog_support import (
    _load_remote as _load_remote,
)
from runtime.platform.plugins._cloud_catalog_support import (
    fetch_public_https_bytes as fetch_public_https_bytes,
)
from runtime.platform.plugins._cloud_catalog_transactions import (
    CloudCatalogTransactionsMixin,
)
from runtime.platform.plugins._cloud_catalog_validation import (
    CloudCatalogValidationMixin,
)
from runtime.platform.plugins.catalog_provenance import (
    catalog_signature_path,
    load_catalog_signature,
    verify_marketplace_catalog,
)
from runtime.platform.plugins.install_errors import (
    ContentPackUnavailableError as ContentPackUnavailableError,
)
from runtime.platform.plugins.marketplace_package import (
    CONNECTOR_RELEASE_SUMMARY,
    verify_marketplace_package_trust,
)
from runtime.platform.plugins.workbench_package import (
    WorkbenchPackageStore,
)
from runtime.platform.process.paths import app_paths


class CloudCatalog(
    CloudCatalogSkillsMixin,
    CloudCatalogInstallMixin,
    CloudCatalogTransactionsMixin,
    CloudCatalogValidationMixin,
):
    """读取云商城插件/技能目录(远程 + 本地镜像回退 + 磁盘缓存)。"""

    KIND_KEYS = {"plugins": "items", "skills": "skills"}

    def __init__(
        self,
        kind: str,
        *,
        use_cache: bool = True,
        use_remote: bool = True,
        trust_store_path: str | Path | None = None,
    ) -> None:
        if kind not in self.KIND_KEYS:
            raise ValueError(f"unknown cloud catalog kind: {kind}")
        self._kind = kind
        self._list_key = self.KIND_KEYS[kind]
        self._file = "plugin-store.json" if kind == "plugins" else "skill-registry.json"
        self._cache_file = _support.CACHE_DIR / f"cloud-{self._file}"
        self._cache_signature_file = catalog_signature_path(self._cache_file)
        self._mirror = _support.LOCAL_MIRROR_DIR / self._file
        self._mirror_signature = catalog_signature_path(self._mirror)
        self._use_cache = use_cache
        self._use_remote = use_remote
        self._trust_store_path = trust_store_path
        self._store: dict[str, Any] | None = None
        self._catalog_trust: dict[str, Any] | None = None
        self._force_remote_once = False

    @staticmethod
    def _read_catalog_file(path: Path) -> dict[str, Any] | None:
        try:
            if not path.is_file() or path.is_symlink() or path.stat().st_size > _MAX_CATALOG_BYTES:
                return None
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def _accept_catalog(
        self,
        store: dict[str, Any] | None,
        envelope: dict[str, Any] | None,
        *,
        require_trusted: bool,
    ) -> dict[str, Any] | None:
        if not isinstance(store, dict) or not store.get(self._list_key):
            return None
        try:
            trust = verify_marketplace_catalog(
                store,
                envelope,
                catalog_name=self._file,
                trust_store_path=self._trust_store_path,
                require_trusted=require_trusted,
            )
        except ValueError:
            return None
        self._catalog_trust = trust
        return store

    def _load_mirror(self, *, require_trusted: bool) -> dict[str, Any] | None:
        return self._accept_catalog(
            self._read_catalog_file(self._mirror),
            load_catalog_signature(self._mirror_signature),
            require_trusted=require_trusted,
        )

    def _load_cache(self) -> dict[str, Any] | None:
        if not self._use_cache:
            return None
        return self._accept_catalog(
            self._read_catalog_file(self._cache_file),
            load_catalog_signature(self._cache_signature_file),
            require_trusted=True,
        )

    def _load_verified_remote(self) -> tuple[dict[str, Any], dict[str, Any]] | None:
        if not self._use_remote:
            return None
        store = _support._load_remote(self._file)
        signature_name = catalog_signature_path(Path(self._file)).name
        envelope = _support._load_remote(signature_name)
        accepted = self._accept_catalog(store, envelope, require_trusted=True)
        if accepted is None or not isinstance(envelope, dict):
            return None
        return accepted, envelope

    def _cache_verified_remote(
        self,
        store: dict[str, Any],
        envelope: dict[str, Any],
    ) -> None:
        if not self._use_cache:
            return
        _support.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            atomic_write_json(self._cache_file, store, sort_keys=True)
            atomic_write_json(self._cache_signature_file, envelope, sort_keys=True)
        except OSError:
            # A failed cache write never changes the already verified in-memory
            # catalog, and a partial pair fails closed on the next process.
            return

    def _load(self) -> dict[str, Any]:
        if self._store is not None:
            return self._store
        store: dict[str, Any] | None = None
        source_checkout = (_support.REPO / ".git").exists()
        prefer_remote = (
            self._force_remote_once or os.environ.get("ECHO_CLOUD_STORE_PREFER_REMOTE") == "1"
        )

        # A source checkout intentionally sees its freshly generated mirror.
        # Packaged builds never trust an unsigned mirror and prefer a verified
        # cache/remote release, so Hub refreshes can actually deliver updates.
        if source_checkout and not prefer_remote:
            store = self._load_mirror(require_trusted=False)
        if store is None and prefer_remote:
            remote = self._load_verified_remote()
            if remote is not None:
                store, envelope = remote
                self._cache_verified_remote(store, envelope)
        if store is None:
            store = self._load_cache()
        if store is None and not prefer_remote:
            remote = self._load_verified_remote()
            if remote is not None:
                store, envelope = remote
                self._cache_verified_remote(store, envelope)
        if store is None:
            store = self._load_mirror(require_trusted=not source_checkout)
        if store is None:
            raise RuntimeError(f"cloud {self._kind} catalog unavailable or untrusted")
        self._store = store
        self._force_remote_once = False
        return store

    def refresh(self) -> None:
        self._store = None
        self._catalog_trust = None
        self._force_remote_once = True
        # Keep the last verified pair available if the network or a release's
        # catalog/signature transition prevents accepting the remote update.
        return self._load()

    def meta(self) -> dict[str, Any]:
        metadata = dict(self._load().get("meta") or {})
        if self._catalog_trust is not None:
            metadata["catalog_trust"] = dict(self._catalog_trust)
        return metadata

    def items(self) -> list[dict[str, Any]]:
        items = list(self._load().get(self._list_key) or [])
        if self._kind == "plugins":
            catalog_items: list[dict[str, Any]] = []
            for raw_item in items:
                if not isinstance(raw_item, dict):
                    continue
                item = dict(raw_item)
                if not str(item.get("release_summary") or "").strip():
                    version = str(item.get("version") or "").strip()
                    if item.get("kind") == "connector":
                        item["release_summary"] = CONNECTOR_RELEASE_SUMMARY
                    elif item.get("kind") == "plugin" and version:
                        item["release_summary"] = (
                            f"{version}：由 Echo 受信发布链重新封装当前插件内容。"
                        )
                catalog_items.append(item)
            items = catalog_items
            # Verified release catalogs are closed-world: runtime defaults may
            # not silently add unsigned packages. Source-checkout mirrors keep
            # lightweight fallbacks for local UI development only.
            allow_dev_defaults = (
                self._catalog_trust is None or self._catalog_trust.get("status") == "local_dev"
            )
            if allow_dev_defaults:
                # The source-checkout descriptors are the authoritative local
                # development contract.  Replace every catalog collision (and
                # collapse duplicate polluted rows) instead of merely appending
                # defaults when an id happens to be absent.
                defaults = (*_REMOTE_SURFACE_PLUGINS, *_WORKBENCH_APPS)
                defaults_by_id = {str(item["id"]): item for item in defaults}
                workbench_defaults_by_package = {
                    str(item["plugin"]): item
                    for item in _WORKBENCH_APPS
                    if item.get("kind") == "workbench"
                }
                merged: list[dict[str, Any]] = []
                emitted_defaults: set[str] = set()
                for item in items:
                    item_id = str(item.get("id") or "")
                    official = defaults_by_id.get(item_id)
                    if official is None and item.get("kind") == "workbench":
                        official = workbench_defaults_by_package.get(str(item.get("plugin") or ""))
                    if official is None:
                        merged.append(item)
                        continue
                    official_id = str(official["id"])
                    if official_id not in emitted_defaults:
                        merged.append(dict(official))
                        emitted_defaults.add(official_id)
                for official in defaults:
                    item_id = str(official["id"])
                    if item_id not in emitted_defaults:
                        merged.append(dict(official))
                        emitted_defaults.add(item_id)
                items = merged
        return items

    def list(
        self,
        *,
        search: str | None = None,
        kind: str | None = None,
        offset: int = 0,
        limit: int = 200,
    ) -> dict[str, Any]:
        items = self.items()
        if kind:
            items = [i for i in items if i.get("kind") == kind]
        if search:
            q = search.lower()
            items = [
                i
                for i in items
                if q in str(i.get("name", "")).lower()
                or q in str(i.get("name_zh", "")).lower()
                or q in str(i.get("description", "")).lower()
                or q in str(i.get("id", "")).lower()
            ]
        total = len(items)
        return {"items": items[offset : offset + limit], "total": total}

    # ── 内容包下载 + 安装(从云端下载内容,解包落地) ──────────
    CONTENT_URLS = {
        "plugins": ("https://ai.echo-age.com/marketplace/echo-plugins.tar.gz"),
        "skills": ("https://ai.echo-age.com/marketplace/echo-skills.tar.gz"),
    }

    def _archive_path(self) -> Path:
        """下载并缓存内容包 tar.gz,返回本地路径。"""
        url = os.environ.get(
            "ECHO_PLUGINS_CONTENT_URL" if self._kind == "plugins" else "ECHO_SKILLS_CONTENT_URL",
            self.CONTENT_URLS[self._kind],
        )
        _support.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        dest = _support.CACHE_DIR / f"echo-{self._kind}.tar.gz"
        # 已缓存且非空 → 直接用
        if dest.exists() and dest.stat().st_size > 0:
            if dest.stat().st_size > _MAX_ARCHIVE_BYTES:
                raise ValueError("cached marketplace archive is too large")
            return dest
        tmp = dest.with_suffix(".part")
        try:
            body = _download_content_pack(
                url,
                timeout=180,
                max_bytes=_MAX_ARCHIVE_BYTES,
            )
            tmp.write_bytes(body)
            tmp.replace(dest)
        finally:
            with contextlib.suppress(OSError):
                tmp.unlink()
        return dest

    @staticmethod
    def _extract_member(
        archive: Path, member_prefix: str, dest_dir: Path, member_name: str
    ) -> Path | None:
        """从 tar.gz 流式解出 prefix 下的单个目录，返回解出目录或 None。"""
        prefix = f"{member_prefix.rstrip('/')}/{member_name}"
        out = dest_dir / member_name
        out_res = out.resolve()
        extracted_bytes = 0
        matched_members = 0
        try:
            # Streaming mode avoids materializing metadata for every unrelated
            # app in the shared content pack. The Browser package alone lives
            # in a ~140 MiB archive, and ``getmembers()`` previously pushed the
            # long-running server close to 1 GiB RSS during a reinstall.
            with tarfile.open(archive, "r|gz") as tf:
                for m in tf:
                    if m.name != prefix and not m.name.startswith(prefix + "/"):
                        continue
                    matched_members += 1
                    if matched_members > _MAX_ARCHIVE_MEMBERS:
                        raise ValueError("marketplace archive contains too many members")
                    # 安全校验:每个成员相对 prefix 的路径必须落在 out 内。
                    # Links/devices/FIFOs are not needed by skills or plugins
                    # and are rejected before their contents are copied.
                    if "\\" in m.name or "\x00" in m.name:
                        raise ValueError(f"unsafe tar path: {m.name}")
                    if not (m.isdir() or m.isreg()):
                        raise ValueError(f"unsupported tar member: {m.name}")
                    rel = os.path.relpath(m.name, prefix)
                    target = (out / rel).resolve()
                    if out_res not in target.parents and target != out_res:
                        raise ValueError(f"unsafe tar path: {m.name}")
                    if m.isreg():
                        if m.size < 0 or m.size > _MAX_MEMBER_BYTES:
                            raise ValueError(f"tar member is too large: {m.name}")
                        extracted_bytes += m.size
                        if extracted_bytes > _MAX_EXTRACTED_BYTES:
                            raise ValueError("marketplace archive expands beyond the size limit")
                    if m.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    source = tf.extractfile(m)
                    if source is None:
                        raise ValueError(f"tar member has no file content: {m.name}")
                    with source, target.open("wb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)
                    target.chmod(0o755 if m.mode & 0o111 else 0o644)
            if matched_members == 0:
                return None
            return out
        except Exception:
            # A late invalid member must not leave a partially installed tree.
            with contextlib.suppress(OSError):
                shutil.rmtree(out)
            raise

    def install_skill(self, name: str, *, skills_dir: str | Path | None = None) -> dict[str, Any]:
        """下载技能内容包,把 skills/<name> 落地到技能目录。"""
        safe = re.sub(r"[^A-Za-z0-9_-]", "_", name).strip("_") or "skill"
        dest_root = Path(skills_dir or self.SKILLS_ROOT)
        dest_root.mkdir(parents=True, exist_ok=True)
        target = dest_root / safe
        if (target / "SKILL.md").exists():
            return {"installed": True, "already_exists": True, "name": safe, "path": str(target)}
        with tempfile.TemporaryDirectory(prefix="echo-skill-") as tmp:
            extracted = self._extract_member(
                self._skill_archive_path(safe), "skills", Path(tmp), safe
            )
            if extracted is None or not (extracted / "SKILL.md").exists():
                raise KeyError(f"skill not found in content pack: {name}")
            if any(child.is_symlink() for child in extracted.rglob("*")):
                raise ValueError(f"skill contains symlinks: {name}")
            shutil.copytree(extracted, target)
        return {"installed": True, "name": safe, "path": str(target), "source": "cloud"}

    def _skill_archive_path(self, name: str) -> Path:
        """Use a catalog-pinned individual download; support older cloud releases."""
        row = next(
            (item for item in self._load().get("skills", []) if item.get("name") == name), {}
        )
        url = row.get("package_url")
        if not url:
            return self._archive_path()
        digest = str(row.get("package_sha256") or "").lower()
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("skill package checksum is missing or invalid")
        import hashlib

        cache = _support.CACHE_DIR / "skills"
        cache.mkdir(parents=True, exist_ok=True)
        target = cache / f"{digest}.tar.gz"
        if (
            target.is_file()
            and target.stat().st_size <= _MAX_ARCHIVE_BYTES
            and hashlib.sha256(target.read_bytes()).hexdigest() == digest
        ):
            return target
        body = _download_content_pack(str(url), timeout=180, max_bytes=_MAX_ARCHIVE_BYTES)
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError("skill package checksum mismatch")
        with tempfile.NamedTemporaryFile(dir=cache, suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
        try:
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return target

    # All mutable deployment state follows ECHO_DATA_DIR. In the container
    # that is the /data PVC/bind mount, never the read-only image layer.
    PLUGIN_INSTALL_ROOT = app_paths().data_dir / "plugins"
    # Cloud-catalog skills are mutable runtime state under the data volume.
    SKILLS_ROOT = app_paths().data_dir / "skills"
    # Codex-format plugins use the same writable path as registry consumers.
    CODEX_CACHE_ROOT = app_paths().codex_plugins_path
    # 连接器安装状态(与 connector_registry 的 state.json 同文件,标记已安装)
    CONNECTOR_STATE_FILE = app_paths().data_dir / "connectors" / "state.json"
    CAPABILITY_STATE_FILE = app_paths().data_dir / "capabilities" / "state.json"

    @staticmethod
    def _slug(value: str) -> str:
        return re.sub(r"[^a-z0-9_-]+", "-", value.strip()).strip("-").lower()

    def _marketplace_transaction_lock_path(self) -> Path:
        return self.PLUGIN_INSTALL_ROOT / ".lifecycle" / "marketplace-transaction"

    def installed_skills(self, skills_dir: str | Path | None = None) -> list[str]:
        """本地已安装技能名(目录含 SKILL.md)。"""
        root = Path(skills_dir or self.SKILLS_ROOT)
        if not root.exists():
            return []
        return sorted(
            d.name
            for d in root.iterdir()
            if d.is_dir() and (d / "SKILL.md").exists() and not d.name.startswith((".", "_"))
        )

    @staticmethod
    def is_factory_plugin(plugin_id: str) -> bool:
        """Return whether *plugin_id* is a lifecycle-managed factory seed.

        The catalog also contains remote workbenches whose runtime code is
        bundled only as a source-checkout convenience.  Keeping this check in
        the catalog prevents a stale ``factory_seed`` field from routing a
        remote package through PluginHub's factory-only lifecycle API.
        """

        return str(plugin_id).strip() in _FACTORY_WORKBENCH_PLUGINS

    def installed_plugins(self) -> list[str]:
        """本地已安装插件/连接器(按存档成员名)。

        来源合并四处,保证线上商城对「本地已有」的项直接标已安装:
          1. 随应用发布且已激活的工厂工作台
          2. 云安装落点 ~/.echo/plugins/<kind>/<id>(本功能装的)
          3. Codex 格式插件 ~/.echo/plugins/codex/<plugin>/.codex-plugin/plugin.json
             (首次自动从旧 ~/.codex/plugins/cache 同步)
          4. 连接器安装状态 ~/.echo/connectors/state.json(installed=true)
        """
        with path_transaction(self._marketplace_transaction_lock_path()):
            self._recover_incomplete_marketplace_transactions()
        names: set[str] = set()
        activation_store = self._workbench_activation_store()
        for plugin_id in _FACTORY_WORKBENCH_PLUGINS:
            if activation_store.state(plugin_id)["installed"]:
                names.add(plugin_id)
        root = self.PLUGIN_INSTALL_ROOT
        if root.exists():
            for kind_dir in root.iterdir():
                if kind_dir.is_dir() and not kind_dir.name.startswith((".", "_")):
                    for d in kind_dir.iterdir():
                        if d.is_dir() and not (
                            kind_dir.name == "workbench" and d.name in _FACTORY_WORKBENCH_PLUGINS
                        ):
                            names.add(d.name)
        codex_cache = self.CODEX_CACHE_ROOT
        if not codex_cache.is_dir():
            from runtime.platform.plugins.codex_discovery import (
                sync_codex_cache_to_echo,
            )

            sync_codex_cache_to_echo(dest=codex_cache)
        if codex_cache.is_dir():
            for manifest in codex_cache.glob("*/.codex-plugin/plugin.json"):
                try:
                    meta = json.loads(manifest.read_text("utf-8"))
                    pid = str(meta.get("name") or "")
                except (OSError, json.JSONDecodeError):  # noqa: BLE001
                    continue
                if pid:
                    names.add(pid)
        if self.CONNECTOR_STATE_FILE.exists():
            try:
                state = json.loads(self.CONNECTOR_STATE_FILE.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):  # noqa: BLE001
                state = {}
            for cid, v in state.items():
                if isinstance(v, dict) and v.get("installed"):
                    names.add(cid)
        return sorted(names)

    def plugin_statuses(self, *, package_id: str | None = None) -> dict[str, dict[str, Any]]:
        """Return the unified lifecycle projection for catalog plugins.

        Keys are install-package ids (the ``plugin`` field consumed by the
        frontend). Catalog ids remain present in each row so callers never have
        to infer whether an item came from a factory seed or a mutable cloud
        package. Transient downloading/uninstalling phases are owned by the
        request/UI operation; this projection is the durable post-operation
        truth.
        """

        if self._kind != "plugins":
            return {}
        installed = set(self.installed_plugins())
        activation_store = self._workbench_activation_store()
        data_store = self._workbench_data_store()
        permission_store = self._marketplace_permission_store()
        statuses: dict[str, dict[str, Any]] = {}
        requested_package_id = package_id
        for item in self.items():
            package_id = str(item.get("plugin") or item.get("id") or "").strip()
            if requested_package_id is not None and package_id != requested_package_id:
                continue
            if not package_id:
                continue
            catalog_id = str(item.get("id") or package_id)
            kind = str(item.get("kind") or "connector")
            if bool(item.get("factory_seed")) and activation_store.is_factory(package_id):
                state = activation_store.state(package_id)
                if state.get("error"):
                    lifecycle_state = "broken"
                elif not state["installed"]:
                    lifecycle_state = "available"
                elif not state["enabled"]:
                    lifecycle_state = "disabled"
                else:
                    lifecycle_state = "enabled"
                statuses[package_id] = {
                    "plugin_id": package_id,
                    "catalog_id": catalog_id,
                    "kind": kind,
                    "source": "factory",
                    "installed": bool(state["installed"]),
                    "enabled": bool(state["enabled"]),
                    "lifecycle_state": lifecycle_state,
                    "version": state.get("version") or item.get("version"),
                    "path": state.get("factory_path"),
                    "data_path": state.get("data_path"),
                    "recoveries": state.get("recoveries", []),
                    "error": state.get("error"),
                    "trust": {
                        "level": "system",
                        "integrity_verified": False,
                        "publisher_verified": False,
                    },
                    "compatibility": {
                        "status": "compatible",
                        "host_api": None,
                    },
                    "permissions_granted": [],
                    "permission_review_required": False,
                    "permission_active": bool(state["enabled"]),
                    "release_summary": str(item.get("release_summary") or "").strip(),
                }
                continue

            is_installed = package_id in installed
            install_kind = (
                "codex" if kind == "plugin" else "workbench" if kind == "workbench" else "connector"
            )
            lifecycle_state = "enabled" if is_installed else "available"
            enabled = (
                self._workbench_package_enabled(package_id)
                if is_installed and install_kind == "workbench"
                else self._marketplace_package_enabled(
                    package_id,
                    plugin_kind=install_kind,
                )
                if is_installed and install_kind in {"codex", "connector"}
                else is_installed
            )
            if is_installed and not enabled:
                lifecycle_state = "disabled"
            error = None
            installed_version: str | None = None
            release_summary = str(item.get("release_summary") or "").strip()
            trust: dict[str, Any] = {
                "level": "unverified" if is_installed else "catalog",
                "integrity_verified": False,
                "publisher_verified": False,
            }
            compatibility: dict[str, Any] = {
                "status": "not_checked",
                "host_api": None,
            }
            requirements: dict[str, Any] = {
                "permissions": list(item.get("permissions") or []),
                "auth_modes": list(item.get("auth_modes") or []),
                "dependencies": list(item.get("dependencies") or []),
                "runtime_dependencies": list(item.get("runtime_dependencies") or []),
                "connectors": list(item.get("connectors") or []),
            }
            if is_installed and install_kind == "workbench":
                try:
                    package_store = WorkbenchPackageStore(self.PLUGIN_INSTALL_ROOT / "workbench")
                    manifest = package_store.load_manifest(package_id)
                    trust_record = package_store.verify_installed_integrity(package_id)
                    installed_version = manifest.version
                    release_summary = manifest.release_summary
                except (FileNotFoundError, ValueError) as exc:
                    lifecycle_state = "broken"
                    enabled = False
                    error = str(exc)
                else:
                    publisher_verified = trust_record.get("publisher_verified") is True
                    trust = {
                        "level": "publisher" if publisher_verified else "local_integrity",
                        "integrity_verified": True,
                        "publisher_verified": publisher_verified,
                    }
                    publisher_id = str(trust_record.get("publisher_id") or "").strip()
                    if publisher_id:
                        trust["publisher_id"] = publisher_id
                    try:
                        self._validate_workbench_compatibility(
                            manifest,
                            install_root=self.PLUGIN_INSTALL_ROOT / "workbench",
                        )
                    except (FileNotFoundError, ValueError) as exc:
                        lifecycle_state = "broken"
                        enabled = False
                        error = str(exc)
                        compatibility = {
                            "status": "incompatible",
                            "host_api": manifest.host_api,
                        }
                    else:
                        compatibility = {
                            "status": "compatible",
                            "host_api": manifest.host_api,
                        }
                        catalog_version = str(item.get("version") or "").strip()
                        if (
                            enabled
                            and catalog_version
                            and self._version_is_newer(
                                catalog_version,
                                installed_version,
                            )
                        ):
                            lifecycle_state = "update_available"
            elif is_installed and install_kind in {"codex", "connector"}:
                trust_record: dict[str, Any] | None = None
                try:
                    package_path = self.PLUGIN_INSTALL_ROOT / install_kind / package_id
                    if install_kind == "codex" and not package_path.is_dir():
                        package_path = self.CODEX_CACHE_ROOT / package_id
                    trust_record = verify_marketplace_package_trust(
                        package_path,
                        package_kind=install_kind,
                        plugin_id=package_id,
                        require_trusted=not (_support.REPO / ".git").exists(),
                    )
                    installed_version = str(trust_record["version"])
                    release_summary = str(trust_record.get("release_summary") or "").strip()
                    self._verify_marketplace_skill_projection(
                        package_path,
                        plugin_id=package_id,
                    )
                except (FileNotFoundError, ValueError) as exc:
                    lifecycle_state = "broken"
                    enabled = False
                    error = str(exc)
                else:
                    publisher_verified = trust_record.get("publisher_verified") is True
                    trust = {
                        "level": "publisher" if publisher_verified else "local_integrity",
                        "integrity_verified": True,
                        "publisher_verified": publisher_verified,
                    }
                    publisher_id = str(trust_record.get("publisher_id") or "").strip()
                    if publisher_id:
                        trust["publisher_id"] = publisher_id
                    requirements = {
                        "permissions": list(trust_record.get("permissions") or []),
                        "auth_modes": list(trust_record.get("auth_modes") or []),
                        "dependencies": list(trust_record.get("dependencies") or []),
                        "runtime_dependencies": list(
                            trust_record.get("runtime_dependencies") or []
                        ),
                        "connectors": list(item.get("connectors") or []),
                    }
                    try:
                        self._validate_marketplace_compatibility(
                            trust_record,
                            plugin_id=package_id,
                        )
                    except ValueError as exc:
                        lifecycle_state = "broken"
                        enabled = False
                        error = str(exc)
                        compatibility = {
                            "status": "incompatible",
                            "host_api": trust_record.get("host_api"),
                        }
                    else:
                        compatibility = {
                            "status": "compatible",
                            "host_api": trust_record.get("host_api"),
                        }
                    catalog_version = str(item.get("version") or "").strip()
                    if (
                        lifecycle_state != "broken"
                        and enabled
                        and catalog_version
                        and self._version_is_newer(catalog_version, installed_version)
                    ):
                        lifecycle_state = "update_available"
            rollback = None
            if is_installed:
                if install_kind == "workbench":
                    rollback = self._latest_workbench_transaction(package_id)
                elif install_kind in {"codex", "connector"}:
                    rollback = self._latest_marketplace_transaction(
                        package_id,
                        plugin_kind=install_kind,
                    )
            permission_granted: list[str] = []
            permission_active = False
            permission_review_required = False
            if is_installed and install_kind in {"codex", "connector"}:
                try:
                    permission_record = permission_store.get(package_id)
                    permission_generation_current = permission_store.generation_current(package_id)
                except RuntimeError:
                    permission_record = None
                    permission_generation_current = False
                    permission_review_required = True
                if isinstance(permission_record, dict) and permission_generation_current:
                    permission_granted = list(permission_record.get("granted") or [])
                    permission_active = permission_record.get("active") is True
                    permission_review_required = set(requirements["permissions"]) != set(
                        permission_granted
                    )
                else:
                    permission_review_required = True
            statuses[package_id] = {
                "plugin_id": package_id,
                "catalog_id": catalog_id,
                "kind": kind,
                "source": "cloud",
                "installed": is_installed,
                "enabled": enabled,
                "lifecycle_state": lifecycle_state,
                "version": installed_version or item.get("version"),
                "available_version": item.get("version"),
                "path": str(self.PLUGIN_INSTALL_ROOT / install_kind / package_id)
                if is_installed
                else None,
                "data_path": None,
                "recoveries": data_store.recoveries(package_id)
                if install_kind == "workbench"
                else [],
                "error": error,
                "runtime_plugin": item.get("runtime_plugin"),
                "rollback_available": rollback is not None,
                "transaction_id": rollback.get("transaction_id") if rollback else None,
                "rollback_operation": rollback.get("operation") if rollback else None,
                "trust": trust,
                "compatibility": compatibility,
                **requirements,
                "permissions_granted": permission_granted,
                "permission_review_required": permission_review_required,
                "permission_active": permission_active,
                "release_summary": release_summary,
            }
        return statuses

    def set_workbench_enabled(self, plugin_id: str, enabled: bool) -> dict[str, Any]:
        """Persistently activate/deactivate a frontend-only workbench package."""

        safe = WorkbenchPackageStore.validate_id(plugin_id)
        root = self.PLUGIN_INSTALL_ROOT / "workbench"
        WorkbenchPackageStore(root, require_integrity=True).load_manifest(safe)
        if not enabled:
            self._ensure_workbench_not_required(safe, enabled_only=True)
        state = self._workbench_package_state()
        state[safe] = bool(enabled)
        atomic_write_json(self._workbench_package_state_path(), state, sort_keys=True)
        return {
            "plugin_id": safe,
            "installed": True,
            "enabled": bool(enabled),
            "lifecycle_state": "enabled" if enabled else "disabled",
            "restart_required": False,
        }

    def _copy_bundled_skills(self, plugin_dir: Path, plugin_id: str) -> list[str]:
        """把插件捆绑的 skills/ 复制到 ~/.echo/skills/<id>__<skill> 并登记。"""
        skills_dir = plugin_dir / "skills"
        if not skills_dir.exists():
            return []
        skills_root = self.SKILLS_ROOT
        skills_root.mkdir(parents=True, exist_ok=True)
        registry_path = skills_root / "registry.json"
        registry: list[dict[str, Any]] = []
        if registry_path.exists():
            try:
                registry = json.loads(registry_path.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):  # noqa: BLE001
                registry = []
        by_name = {e.get("name"): e for e in registry}
        copied: list[str] = []
        for skill_md in sorted(skills_dir.rglob("SKILL.md")):
            slug = self._slug(f"{plugin_id}__{skill_md.parent.name}")
            dest = skills_root / slug
            if dest.exists():
                copied.append(slug)
                continue
            shutil.copytree(skill_md.parent, dest)
            meta = {"name": slug, "author": f"cloud-plugin:{plugin_id}", "source": "cloud"}
            (dest / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")
            by_name[slug] = {
                "name": slug,
                "version": "0.1.0",
                "author": meta["author"],
                "description": f"云插件 {plugin_id} 捆绑技能",
                "tags": [plugin_id, "cloud"],
                "source": "cloud",
            }
            copied.append(slug)
        atomic_write_json(registry_path, list(by_name.values()), sort_keys=True)
        return copied

    def _bundled_skill_ids(self, plugin_id: str) -> set[str]:
        prefix = f"{plugin_id}__"
        if not self.SKILLS_ROOT.is_dir():
            return set()
        return {
            candidate.name
            for candidate in self.SKILLS_ROOT.iterdir()
            if candidate.is_dir() and candidate.name.startswith(prefix)
        }

    def _remove_bundled_skill_ids(self, skill_ids: set[str]) -> None:
        if not skill_ids:
            return
        for skill_id in skill_ids:
            target = self.SKILLS_ROOT / skill_id
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
        registry_path = self.SKILLS_ROOT / "registry.json"
        try:
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return
        if isinstance(registry, list):
            filtered = [
                entry
                for entry in registry
                if not isinstance(entry, dict) or str(entry.get("name") or "") not in skill_ids
            ]
            atomic_write_json(registry_path, filtered, sort_keys=True)
