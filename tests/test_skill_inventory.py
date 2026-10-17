from pathlib import Path

from runtime.platform.assets.skill_inventory import scan_local_skills


def write_skill(root: Path, folder: str, text: str) -> None:
    target = root / folder / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def test_inventory_deduplicates_names_and_overlapping_roots(tmp_path):
    write_skill(
        tmp_path,
        "a",
        "---\nname: Writer\nmetadata:\n  author: Test Author\ndescription: |\n  A long\n  description\n---\nFirst",
    )
    write_skill(tmp_path, "b/nested", "---\nname: writer\n---\nSecond")
    write_skill(tmp_path, "node_modules/ignored", "Ignored")
    result = scan_local_skills([(tmp_path, "builtin"), (tmp_path / "b", "local")])
    assert len(result) == 1
    assert result[0]["author"] == "Test Author"
    assert len(result[0]["variants"]) == 2
    assert result[0]["description"] == "A long\ndescription\n"
    assert result[0]["variants"][0]["sha256"] != result[0]["variants"][1]["sha256"]


def test_inventory_refreshes_after_add_remove_and_handles_missing_metadata(tmp_path):
    assert scan_local_skills([(tmp_path, "local")]) == []
    write_skill(tmp_path, "fallback", "No frontmatter")
    assert scan_local_skills([(tmp_path, "local")])[0]["name"] == "fallback"
    (tmp_path / "fallback" / "SKILL.md").unlink()
    assert scan_local_skills([(tmp_path, "local")]) == []


def test_staging_keeps_script_variants_and_excludes_credentials(tmp_path):
    from tools.prepare_skill_cloud_inventory import package_skill

    root = tmp_path / "input"
    out = tmp_path / "output"
    out.mkdir()
    write_skill(root, "one", "---\nname: example\n---\nSame prompt")
    skill = root / "one"
    (skill / "run.py").write_text("print(1)")
    (skill / ".env").write_text("test fixture")
    first = package_skill(skill, "example", out)
    assert first["excluded"] == [".env"]
    assert first["sha256"] == package_skill(skill, "example", out)["sha256"]
    (skill / "run.py").write_text("print(2)")
    assert first["sha256"] != package_skill(skill, "example", out)["sha256"]


def test_startup_warms_the_inventory_in_the_background(monkeypatch):
    import threading

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.platform.assets import skill_inventory

    scanned = threading.Event()

    def fake_roots(*_args, **_kwargs):
        scanned.set()
        raise OSError("disk went away")  # a failed warm-up must not break startup

    monkeypatch.setattr(skill_inventory, "skill_roots", fake_roots)
    app = FastAPI()
    skill_inventory.warm_on_startup(app)

    with TestClient(app):
        assert scanned.wait(5)


def test_the_warm_up_stops_when_the_app_shuts_down(monkeypatch, tmp_path):
    import itertools
    import threading
    import time

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from runtime.platform.assets import skill_inventory

    started = threading.Event()

    def endless_files(_root):
        for index in itertools.count():
            yield type("Entry", (), {"path": str(tmp_path / f"{index}" / "SKILL.md")})()

    def slow_parse(_entry, _resolved):
        started.set()
        time.sleep(0.01)

    monkeypatch.setattr(skill_inventory, "skill_roots", lambda: [(tmp_path, "test")])
    monkeypatch.setattr(skill_inventory, "_skill_files", endless_files)
    monkeypatch.setattr(skill_inventory, "_parse_skill", slow_parse)
    app = FastAPI()
    skill_inventory.warm_on_startup(app)

    with TestClient(app):
        assert started.wait(5)
    # A scan of hundreds of files used to outlive a quickly closed app.
    assert not any(t.name == "skill-inventory-warm" for t in threading.enumerate())
