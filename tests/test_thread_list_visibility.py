from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.memory.threads.list_visibility import ThreadListVisibility
from runtime.memory.threads.store import ThreadStateStore
from runtime.sensing.gateway.thread_state_router import create_thread_state_router


def test_visibility_is_durable_idempotent_and_scoped(tmp_path: Path):
    store = ThreadListVisibility(tmp_path)
    store.set_hidden("tenant-a", "alice", "chat", True)
    store.set_hidden("tenant-a", "alice", "chat", True)
    restarted = ThreadListVisibility(tmp_path)
    assert restarted.hidden_ids("tenant-a", "alice") == {"chat"}
    assert restarted.hidden_ids("tenant-b", "alice") == set()
    assert restarted.hidden_ids("tenant-a", "bob") == set()
    restarted.set_hidden("tenant-a", "alice", "chat", False)
    assert store.hidden_ids("tenant-a", "alice") == set()


def test_hide_restore_does_not_touch_thread_and_filters_before_pagination(tmp_path: Path):
    store = ThreadStateStore(path=tmp_path / "threads.jsonl")
    for name in ("a", "b", "c"):
        store.ensure_thread(name, values={"title": name})
    before = {name: store.get(name) for name in ("a", "b", "c")}
    app = FastAPI()
    app.include_router(create_thread_state_router(store=store))
    client = TestClient(app)
    assert client.put("/api/threads/c/list-visibility", json={"hidden": True}).status_code == 200
    page = client.post("/api/threads/search", json={"limit": 1}).json()
    assert [row["thread_id"] for row in page] == ["b"]
    page = client.post("/api/threads/search", json={"limit": 1, "offset": 1}).json()
    assert [row["thread_id"] for row in page] == ["a"]
    assert client.get("/api/threads/c").status_code == 200
    removed = client.post("/api/threads/search", json={"hidden_only": True}).json()
    assert [row["thread_id"] for row in removed] == ["c"]
    assert client.put("/api/threads/c/list-visibility", json={"hidden": "false"}).status_code == 422
    assert client.put("/api/threads/missing/list-visibility", json={"hidden": True}).status_code == 404
    assert client.put("/api/threads/c/list-visibility", json={"hidden": False}).status_code == 200
    assert len(client.post("/api/threads/search", json={}).json()) == 3
    assert before == {name: store.get(name) for name in ("a", "b", "c")}
