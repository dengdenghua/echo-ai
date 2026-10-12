"""Reuse metadata parsing without retaining lifecycle or authorization state."""

from __future__ import annotations

import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from runtime.platform.plugins import plugin_hub
from runtime.platform.plugins.plugin_hub import PluginHub


def _plugin(root: Path, name: str = "cached", *, description: str = "first") -> Path:
    directory = root / name
    directory.mkdir(parents=True)
    (directory / "plugin.yaml").write_text(
        f"name: {name}\ndescription: {description}\n"
        "config_schema:\n  properties:\n    color:\n      default: blue\n"
        "config:\n  color: blue\n"
        "contributes:\n  echo:\n    tools: [cached.read]\n",
        encoding="utf-8",
    )
    return directory


def test_listing_and_detail_parse_each_unchanged_manifest_once(tmp_path: Path) -> None:
    _plugin(tmp_path)
    hub = PluginHub(plugin_dir=tmp_path)
    with patch.object(yaml, "safe_load", wraps=yaml.safe_load) as parse:
        first = hub.list_plugins()
        detail = hub.get_plugin_detail("cached")
        second = hub.list_plugins()

    assert first == second
    assert detail == first[0]
    assert parse.call_count == 1


def test_cached_nested_metadata_is_not_shared_with_callers_or_other_hubs(tmp_path: Path) -> None:
    left = _plugin(tmp_path / "left")
    right = _plugin(tmp_path / "right", description="other")
    hub = PluginHub(plugin_dir=left.parent)
    other = PluginHub(plugin_dir=right.parent)

    first = hub.list_plugins()[0]
    first["contributes"]["echo"]["tools"].append("poisoned")
    first["config_schema"]["properties"]["color"]["default"] = "poisoned"
    read = hub._read_manifest_file(left)
    assert read is not None
    read["config"]["color"] = "poisoned"

    fresh = hub.list_plugins()[0]
    assert fresh["contributes"]["echo"]["tools"] == ["cached.read"]
    assert fresh["config_schema"]["properties"]["color"]["default"] == "blue"
    assert hub._read_manifest_file(left)["config"]["color"] == "blue"
    assert other.list_plugins()[0]["description"] == "other"


@pytest.mark.parametrize("replace_file", [False, True])
def test_same_size_edit_or_replacement_with_preserved_mtime_is_seen(
    tmp_path: Path, replace_file: bool
) -> None:
    directory = _plugin(tmp_path)
    hub = PluginHub(plugin_dir=tmp_path)
    path = directory / "plugin.yaml"
    assert hub.list_plugins()[0]["description"] == "first"
    before = path.stat()
    updated = path.read_text(encoding="utf-8").replace("first", "later")
    if replace_file:
        replacement = directory / "replacement.yaml"
        replacement.write_text(updated, encoding="utf-8")
        os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
        replacement.replace(path)
    else:
        path.write_text(updated, encoding="utf-8")
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))

    assert path.stat().st_size == before.st_size
    assert path.stat().st_mtime_ns == before.st_mtime_ns
    assert hub.list_plugins()[0]["description"] == "later"


def test_manifest_priority_removal_and_reinstallation_are_live(tmp_path: Path) -> None:
    directory = tmp_path / "cached"
    directory.mkdir()
    json_path = directory / "plugin.json"
    json_path.write_text(json.dumps({"name": "cached", "description": "json"}))
    hub = PluginHub(plugin_dir=tmp_path)
    assert hub.list_plugins()[0]["description"] == "json"

    yaml_path = directory / "plugin.yaml"
    yaml_path.write_text("name: cached\ndescription: yaml\n")
    assert hub.list_plugins()[0]["description"] == "yaml"
    yaml_path.write_text("name: [invalid yaml\n")
    assert hub.list_plugins()[0]["description"] == "json"
    yaml_path.unlink()
    assert hub.list_plugins()[0]["description"] == "json"
    json_path.unlink()
    assert hub._read_manifest_file(directory) is None
    assert hub.list_plugins() == []
    shutil.rmtree(directory)
    _plugin(tmp_path, description="reinstalled")
    assert hub.list_plugins()[0]["description"] == "reinstalled"


def test_same_file_cannot_reuse_a_different_manifest_parser(tmp_path: Path) -> None:
    source = _plugin(tmp_path / "source")
    target = tmp_path / "target" / "cached"
    target.mkdir(parents=True)
    (target / "plugin.json").symlink_to(source / "plugin.yaml")
    hub = PluginHub(plugin_dir=tmp_path)
    assert hub._read_manifest_file(source) is not None
    # Valid YAML is not automatically a valid JSON manifest, even if the two
    # paths point at the same inode in the same hub.
    assert hub._read_manifest_file(target) is None


def test_retargeted_manifest_symlink_uses_its_current_file(tmp_path: Path) -> None:
    first = _plugin(tmp_path / "first")
    later = _plugin(tmp_path / "later", description="later")
    visible = tmp_path / "visible"
    visible.mkdir()
    link = visible / "plugin.yaml"
    link.symlink_to(first / "plugin.yaml")
    hub = PluginHub(plugin_dir=tmp_path)
    assert hub._read_manifest_file(visible)["description"] == "first"
    link.unlink()
    link.symlink_to(later / "plugin.yaml")
    assert hub._read_manifest_file(visible)["description"] == "later"


def test_file_changed_during_parsing_is_not_cached_as_the_new_version(tmp_path: Path) -> None:
    directory = _plugin(tmp_path)
    path = directory / "plugin.yaml"
    hub = PluginHub(plugin_dir=tmp_path)
    original = yaml.safe_load

    def parse_and_rewrite(raw: str):
        parsed = original(raw)
        path.write_text(raw.replace("first", "later"), encoding="utf-8")
        return parsed

    with patch.object(yaml, "safe_load", parse_and_rewrite):
        assert hub._read_manifest_file(directory)["description"] == "first"
    assert not hub._manifest_cache
    assert hub._read_manifest_file(directory)["description"] == "later"


def test_cache_is_bounded_and_large_manifests_are_not_retained(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(plugin_hub, "_MAX_CACHED_MANIFESTS", 2)
    directories = [_plugin(tmp_path, name=f"cached{index}") for index in range(3)]
    hub = PluginHub(plugin_dir=tmp_path)
    with patch.object(yaml, "safe_load", wraps=yaml.safe_load) as parse:
        for directory in directories:
            assert hub._read_manifest_file(directory) is not None
        assert len(hub._manifest_cache) == 2
        assert hub._read_manifest_file(directories[0]) is not None
        assert parse.call_count == 4

    monkeypatch.setattr(plugin_hub, "_MAX_CACHED_MANIFEST_BYTES", 1)
    uncached = PluginHub(plugin_dir=tmp_path)
    with patch.object(yaml, "safe_load", wraps=yaml.safe_load) as parse:
        assert uncached._read_manifest_file(directories[0]) is not None
        assert uncached._read_manifest_file(directories[0]) is not None
        assert parse.call_count == 2
    assert not uncached._manifest_cache


def test_concurrent_metadata_reads_share_one_parse(tmp_path: Path) -> None:
    directory = _plugin(tmp_path)
    hub = PluginHub(plugin_dir=tmp_path)
    with patch.object(yaml, "safe_load", wraps=yaml.safe_load) as parse:
        with ThreadPoolExecutor(max_workers=4) as pool:
            records = list(pool.map(lambda _: hub._read_manifest_file(directory), range(8)))
        assert parse.call_count == 1
    assert all(record == records[0] for record in records)
    assert records[0] is not records[1]


def test_metadata_reads_do_not_wait_for_plugin_startup_or_connection_lock(tmp_path: Path) -> None:
    directory = _plugin(tmp_path)
    hub = PluginHub(plugin_dir=tmp_path)
    with ThreadPoolExecutor(max_workers=1) as pool:
        hub._lock_internal.acquire()
        try:
            read = pool.submit(hub._read_manifest_file, directory)
            record = read.result(timeout=1)
        finally:
            hub._lock_internal.release()
    assert record["description"] == "first"


def test_external_enabled_state_is_read_once_per_scan_and_rechecked_after_changes(
    tmp_path: Path,
) -> None:
    for name in ("first", "second", "third"):
        _plugin(tmp_path, name)
    hub = PluginHub(plugin_dir=tmp_path)
    hub._write_external_enabled("first", True)
    original = Path.read_text
    reads: list[Path] = []

    def read(path: Path, *args, **kwargs):
        if path == hub._external_state_path:
            reads.append(path)
        return original(path, *args, **kwargs)

    with patch.object(Path, "read_text", read):
        assert all(item["enabled"] for item in hub.discover())
        assert len(reads) == 1
        hub._write_external_enabled("first", False)
        reads.clear()
        states = {item["id"]: item["enabled"] for item in hub.discover()}
        assert states == {"first": False, "second": True, "third": True}
        assert len(reads) == 1
        hub._external_state_path.write_text("invalid")
        reads.clear()
        broken = hub.discover()
        assert len(reads) == 1
        assert all(not item["enabled"] for item in broken)
        assert all(item["activation_error"] == "invalid_external_runtime_state" for item in broken)
        hub._external_state_path.unlink()
        assert all(item["enabled"] for item in hub.discover())


def test_lifecycle_and_persisted_configuration_do_not_come_from_metadata_cache(
    tmp_path: Path,
) -> None:
    directory = _plugin(tmp_path, "cached_lifecycle")
    (directory / "__init__.py").write_text(
        "from runtime.platform.plugins.plugin_base import ModulePlugin\n"
        "class CachedPlugin(ModulePlugin):\n"
        "    name = 'cached_lifecycle'\n",
        encoding="utf-8",
    )
    hub = PluginHub(plugin_dir=tmp_path)
    assert not hub.list_plugins()[0]["loaded"]
    assert hub.load("cached_lifecycle") is not None
    assert hub.start("cached_lifecycle") is True
    assert hub.list_plugins()[0]["started"] is True
    assert hub.update_plugin_config("cached_lifecycle", {"color": "green"}) is True
    assert hub._read_manifest_file(directory)["config"]["color"] == "green"
    assert hub.stop("cached_lifecycle") is True
    assert hub.list_plugins()[0]["started"] is False
    assert hub.unload("cached_lifecycle") is True
    assert hub.list_plugins()[0]["loaded"] is False
    assert hub.disable_plugin("cached_lifecycle")["enabled"] is False
    assert hub.list_plugins()[0]["enabled"] is False
    assert hub.enable_plugin("cached_lifecycle")["enabled"] is True
    assert hub.list_plugins()[0]["started"] is True
    hub.unload_all()
