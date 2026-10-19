import pytest

from runtime.execution.suckers.plugin_references import read_plugin_reference
from runtime.platform.capabilities.permission_grants import (
    CapabilityPermissionStore,
    use_capability_permission_store,
)
from runtime.safety.auth import path_denylist


@pytest.fixture
def docs(tmp_path, monkeypatch):
    skill = tmp_path / "AppData" / "plugin" / "skills" / "test"
    (skill / "references").mkdir(parents=True)
    (skill / "references/plan.md").write_text("first\nsecond\nthird", encoding="utf-8")
    monkeypatch.setattr(path_denylist, "_DEFAULT_DENIES", (str(tmp_path / "AppData"),))
    monkeypatch.setenv("ECHO_PATH_DENYLIST_PATH", str(tmp_path / "deny.json"))
    store = CapabilityPermissionStore(tmp_path / "grants.json")
    store.stage("test-plugin", kind="codex", required=[])
    store.grant("test-plugin", [])
    store.set_active("test-plugin", True)
    with use_capability_permission_store(store):
        yield skill, store


def test_reference_reader_preserves_default_host_denylist_and_pages_docs(docs):
    skill, _ = docs
    assert path_denylist.is_blocked(skill / "references/plan.md")[0]
    result = read_plugin_reference(skill, "test-plugin", "references/plan.md", 1, 1)
    assert result["content"] == "second" and result["truncated"]


@pytest.mark.parametrize(
    "path",
    ["../../secret.md", "/etc/passwd", "SKILL.md", "references/../SKILL.md", "references/run.py"],
)
def test_reference_reader_rejects_non_reference_paths(docs, path):
    assert "error" in read_plugin_reference(docs[0], "test-plugin", path, 0, 200)


def test_reference_reader_honors_explicit_deny_and_revocation(docs):
    skill, store = docs
    path_denylist.add_user_denylist_entry(str(skill / "references"))
    assert (
        "explicit path policy"
        in read_plugin_reference(skill, "test-plugin", "references/plan.md", 0, 200)["error"]
    )
    path_denylist.remove_user_denylist_entry(str(skill / "references"))
    store.set_active("test-plugin", False)
    assert "error" in read_plugin_reference(skill, "test-plugin", "references/plan.md", 0, 200)


def test_reference_reader_rejects_symlink_escape(docs, tmp_path):
    skill, _ = docs
    outside = tmp_path / "outside.md"
    outside.write_text("private")
    try:
        (skill / "references/link.md").symlink_to(outside)
    except OSError:
        pytest.skip("symlink unavailable")
    assert "error" in read_plugin_reference(skill, "test-plugin", "references/link.md", 0, 200)


@pytest.mark.parametrize("grant", [True, False])
def test_only_server_owned_desktop_workspace_is_exempt_from_appdata_default(
    tmp_path, monkeypatch, grant
):
    from runtime.platform.process.session import Session, session_scope
    from runtime.safety.auth.path_guard import check_path

    state = tmp_path / "AppData/echo/data"
    work = state / "workspaces/current"
    work.mkdir(parents=True)
    sibling = state / "workspaces/other"
    sibling.mkdir()
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData"))
    monkeypatch.setenv("ECHO_DATA_DIR", str(state))
    monkeypatch.setenv("ECHO_PATH_DENYLIST_PATH", str(tmp_path / "deny-paths.json"))
    with session_scope(
        Session(metadata={"_host_workspace_read_root": work if grant else str(work)})
    ):
        assert check_path(work / "result.png").allow is grant
        assert not check_path(sibling / "result.png").allow
        assert not check_path(state / "identities.json").allow
        if grant:
            path_denylist.add_user_denylist_entry("%APPDATA%")
            assert not check_path(work / "result.png").allow
