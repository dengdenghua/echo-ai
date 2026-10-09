import asyncio
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from runtime.platform.io.file_coordination import (
    FileCoordinationConflict,
    coordinate_file_mutations,
)
from runtime.workspace.directory_sync import apply_sync, plan_sync


@pytest.fixture(autouse=True)
def lock_root(tmp_path, monkeypatch):
    root = tmp_path / "locks"
    monkeypatch.setattr("runtime.platform.io.file_coordination._lock_root", lambda: root)
    return root


def test_nested_same_owner_but_other_thread_conflicts(tmp_path):
    target = tmp_path / "file"

    def other_writer():
        with pytest.raises(FileCoordinationConflict), coordinate_file_mutations([target]):
            pytest.fail("concurrent writer entered")

    with (
        coordinate_file_mutations([target]),
        coordinate_file_mutations([target]),
        ThreadPoolExecutor() as pool,
    ):
        pool.submit(other_writer).result(timeout=3)
    with coordinate_file_mutations([target]):
        target.write_text("released")


def test_async_tasks_on_same_thread_do_not_share_ownership(tmp_path):
    async def scenario():
        async def competitor():
            with (
                pytest.raises(FileCoordinationConflict),
                coordinate_file_mutations([tmp_path / "f"]),
            ):
                pytest.fail("different task entered")

        with coordinate_file_mutations([tmp_path / "f"]):
            await asyncio.create_task(competitor())

    asyncio.run(scenario())


def test_process_death_releases_file_lock(tmp_path, lock_root):
    target = tmp_path / "file"
    code = (
        "import sys,time; from pathlib import Path; "
        "import runtime.platform.io.file_coordination as c; "
        "c._lock_root=lambda:Path(sys.argv[1]); "
        "guard=c.coordinate_file_mutations([sys.argv[2]]); guard.__enter__(); "
        "print('locked',flush=True); time.sleep(30)"
    )
    worker = subprocess.Popen(
        [sys.executable, "-c", code, str(lock_root), str(target)],
        cwd=Path(__file__).resolve().parents[1],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        with ThreadPoolExecutor() as pool:
            assert pool.submit(worker.stdout.readline).result(timeout=10).strip() == "locked"
        with pytest.raises(FileCoordinationConflict), coordinate_file_mutations([target]):
            pytest.fail("other process entered")
    finally:
        worker.kill()
        worker.wait(timeout=5)
        worker.stdout.close()
    with coordinate_file_mutations([target]):
        target.write_text("recovered")


def test_sync_rejects_active_writer_before_any_copy(tmp_path):
    local, shared = tmp_path / "local", tmp_path / "shared"
    local.mkdir()
    shared.mkdir()
    (local / "a").write_text("a")
    (local / "z").write_text("z")
    plan = plan_sync(local, shared, {})
    with (
        coordinate_file_mutations([local / "z"]),
        ThreadPoolExecutor() as pool,
        pytest.raises(FileCoordinationConflict),
    ):
        pool.submit(apply_sync, local, shared, plan).result(timeout=3)
    assert list(shared.iterdir()) == []


def test_sync_rechecks_whole_batch_before_first_copy(tmp_path):
    local, shared = tmp_path / "local", tmp_path / "shared"
    local.mkdir()
    shared.mkdir()
    for name in ("a", "z"):
        (local / name).write_text(name)
    plan = plan_sync(local, shared, {})
    (local / "z").write_text("changed")
    with pytest.raises(ValueError, match="changed"):
        apply_sync(local, shared, plan)
    assert list(shared.iterdir()) == []
