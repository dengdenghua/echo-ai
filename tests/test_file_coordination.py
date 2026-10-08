import asyncio
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from runtime.platform.io.file_coordination import (
    FileCoordinationConflict,
    coordinate_file_mutations,
)
from runtime.platform.io.file_coordination import (
    _lock_root as default_lock_root,
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
    # The OS releases the dead worker's lock, but Windows does so
    # asynchronously after TerminateProcess ("the time it takes ... depends
    # upon available system resources" -- LockFileEx docs), so the lock can
    # still be held for a moment after wait() returns. Use a bounded wait
    # instead of a zero-timeout probe; a lock that is never released still
    # fails here.
    with coordinate_file_mutations([target], timeout_s=10):
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


def test_default_namespace_is_independent_of_instance_state(tmp_path, monkeypatch):
    user_home = tmp_path / "os-user"
    monkeypatch.setenv("HOME", str(user_home))
    monkeypatch.setenv("USERPROFILE", str(user_home))
    monkeypatch.delenv("ECHO_FILE_LOCK_DIR", raising=False)
    monkeypatch.setenv("ECHO_HOME", str(tmp_path / "instance-a"))
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "instance-a-data"))
    first = default_lock_root()
    monkeypatch.setenv("ECHO_HOME", str(tmp_path / "instance-b"))
    monkeypatch.setenv("ECHO_DATA_DIR", str(tmp_path / "instance-b-data"))
    assert default_lock_root() == first == user_home / ".echo/coordination/file-locks-v1"


@pytest.mark.parametrize("value", ["", " ", "relative-locks"])
def test_invalid_explicit_namespace_is_rejected(monkeypatch, value):
    monkeypatch.setenv("ECHO_FILE_LOCK_DIR", value)
    with pytest.raises(FileCoordinationConflict, match="absolute"):
        default_lock_root()


def test_absolute_namespace_override_is_honoured(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_FILE_LOCK_DIR", str(tmp_path / "shared-locks"))
    assert default_lock_root() == (tmp_path / "shared-locks").resolve()


def test_unavailable_lock_directory_fails_before_mutation(tmp_path, monkeypatch):
    bad_root = tmp_path / "not-a-directory"
    bad_root.write_text("existing")
    monkeypatch.setattr("runtime.platform.io.file_coordination._lock_root", lambda: bad_root)
    target = tmp_path / "protected-file"
    with pytest.raises(FileCoordinationConflict), coordinate_file_mutations([target]):
        target.write_text("must-not-be-written")
    assert not target.exists()
    assert bad_root.read_text() == "existing"


def test_distinct_instance_processes_contend_and_owner_death_releases(tmp_path):
    """Use the real default namespace, not a shared monkeypatched lock root."""
    user_home = tmp_path / "os-user"
    user_home.mkdir()
    target = tmp_path / "shared-file"
    script = """
import json, sys, time
from pathlib import Path
from runtime.platform.io.file_coordination import (
    FileCoordinationConflict, _lock_root, coordinate_file_mutations,
)
try:
    with coordinate_file_mutations([sys.argv[1]]):
        if sys.argv[2] == 'hold':
            print(json.dumps({'state': 'locked', 'root': str(_lock_root())}), flush=True)
            time.sleep(30)
        else:
            Path(sys.argv[1]).write_text('recovered')
            print(json.dumps({'state': 'entered'}), flush=True)
except FileCoordinationConflict:
    print(json.dumps({'state': 'blocked', 'root': str(_lock_root())}), flush=True)
"""
    environments = []
    for name in ("instance-a", "instance-b"):
        env = dict(os.environ)
        env.pop("ECHO_FILE_LOCK_DIR", None)
        env.update(
            HOME=str(user_home),
            USERPROFILE=str(user_home),
            ECHO_HOME=str(tmp_path / name),
            ECHO_DATA_DIR=str(tmp_path / (name + "-data")),
            PYTHONUTF8="1",
            PYTHONDONTWRITEBYTECODE="1",
        )
        environments.append(env)
    root = Path(__file__).resolve().parents[1]
    worker = subprocess.Popen(
        [sys.executable, "-B", "-c", script, str(target), "hold"],
        cwd=root,
        env=environments[0],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        with ThreadPoolExecutor() as pool:
            holder = json.loads(pool.submit(worker.stdout.readline).result(timeout=10))
        assert holder["state"] == "locked"
        result = subprocess.run(
            [sys.executable, "-B", "-c", script, str(target), "try"],
            cwd=root,
            env=environments[1],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        competitor = json.loads(result.stdout)
        assert competitor["state"] == "blocked"
        assert competitor["root"] == holder["root"]
        assert not target.exists()
    finally:
        worker.kill()
        worker.wait(timeout=5)
        worker.stdout.close()
        worker.stderr.close()
    result = subprocess.run(
        [sys.executable, "-B", "-c", script, str(target), "try"],
        cwd=root,
        env=environments[1],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    assert json.loads(result.stdout)["state"] == "entered"
    assert target.read_text() == "recovered"
