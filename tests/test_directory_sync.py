import pytest

from runtime.workspace.directory_sync import apply_sync, plan_sync


@pytest.fixture
def pair(tmp_path):
    a, b = tmp_path / "local", tmp_path / "shared"
    a.mkdir()
    b.mkdir()
    return a, b


def test_initial_sync_and_one_sided_edits(pair):
    a, b = pair
    (a / "local.txt").write_text("local")
    (b / "shared.txt").write_text("shared")
    plan = plan_sync(a, b, {})
    assert {i["direction"] for i in plan["actions"]} == {"pull", "push"}
    baseline = apply_sync(a, b, plan)
    assert (a / "shared.txt").read_text() == "shared"
    assert (b / "local.txt").read_text() == "local"
    (a / "local.txt").write_text("changed local")
    (b / "shared.txt").write_text("changed shared")
    baseline = apply_sync(a, b, plan_sync(a, b, baseline))
    assert (a / "shared.txt").read_text() == "changed shared"
    assert (b / "local.txt").read_text() == "changed local"
    assert not plan_sync(a, b, baseline)["actions"]


def test_conflicts_and_deletions_never_overwrite(pair):
    a, b = pair
    for root in pair:
        (root / "same").write_text("original")
    baseline = apply_sync(a, b, plan_sync(a, b, {}))
    (a / "same").write_text("ours")
    (b / "same").write_text("theirs")
    plan = plan_sync(a, b, baseline)
    assert plan["conflicts"] == ["same"]
    assert not plan["actions"]
    apply_sync(a, b, plan)
    assert (b / "same").read_text() == "theirs"
    (a / "same").unlink()
    assert plan_sync(a, b, baseline)["conflicts"] == ["same"]
    assert not (a / "same").exists()


def test_preview_changes_and_exclusions(pair):
    a, b = pair
    (a / ".env").write_text("secret")
    (a / "node_modules").mkdir()
    (a / "node_modules" / "lib.js").write_text("dependency")
    (a / "file").write_text("before")
    plan = plan_sync(a, b, {})
    assert set(plan["skipped"]) == {".env", "node_modules"}
    (a / "file").write_text("after")
    assert plan_sync(a, b, {})["token"] != plan["token"]
    with pytest.raises(ValueError, match="changed"):
        apply_sync(a, b, plan)
    assert list(b.iterdir()) == []


def test_nested_roots_and_symlinks(pair, tmp_path):
    a, b = pair
    with pytest.raises(ValueError, match="non-nested"):
        plan_sync(a, a, {})
    nested = a / "nested"
    nested.mkdir()
    with pytest.raises(ValueError, match="non-nested"):
        plan_sync(a, nested, {})
    target = tmp_path / "secret.txt"
    target.write_text("secret")
    try:
        (a / "linked").symlink_to(target)
    except OSError:
        pytest.skip("OS does not permit symlinks")
    plan = plan_sync(a, b, {})
    assert "linked" in plan["skipped"]
    assert not plan["actions"]


def test_limits(pair, monkeypatch):
    import runtime.workspace.directory_sync as module

    monkeypatch.setattr(module, "MAX_BYTES", 2)
    (pair[0] / "large").write_bytes(b"123")
    with pytest.raises(ValueError, match="exceeds"):
        plan_sync(*pair, {})
