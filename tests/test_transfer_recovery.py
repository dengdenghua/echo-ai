import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.tentacle.base import ToolResult
from runtime.tentacle.mirror_api import create_mirror_router
from runtime.tentacle.transfer_journal import TransferJournal

BEGIN = {"operation": "begin", "name": "a.bin", "size": 8, "sha256": "a" * 64}


def test_restart_keeps_confirmed_offset_and_fences_previous_window(tmp_path):
    path = tmp_path / "transfers.sqlite3"
    before = TransferJournal(path)
    before.prepare("phone", "receipt", BEGIN, "window-one")
    before.observe("phone", "receipt", BEGIN, {"offset": 4}, "window-one")
    after = TransferJournal(path)
    job = after.snapshot()[0]
    assert (job["state"], job["bytes"], job["sha256"]) == ("interrupted", 4, "a" * 64)
    assert "_attempt" not in job
    after.prepare("phone", "receipt", BEGIN, "window-two")
    with pytest.raises(ValueError, match="其他窗口"):
        after.prepare("phone", "receipt", {"operation": "chunk"}, "window-one")
    assert not after.report("phone", "receipt", "cancelled", "window-one")
    after.observe("phone", "receipt", {"operation": "chunk"}, {"offset": 8}, "window-two")
    assert not after.report("phone", "receipt", "done", "window-two")
    after.observe(
        "phone", "receipt", {"operation": "complete"}, {"name": "a.bin", "size": 8}, "window-two"
    )
    assert TransferJournal(path).snapshot()[0]["state"] == "done"
    assert not after.report("phone", "receipt", "error", "window-two")


def test_active_owner_and_file_identity_cannot_be_overwritten():
    journal = TransferJournal()
    journal.prepare("phone", "receipt", BEGIN, "one")
    with pytest.raises(ValueError, match="正在传输"):
        journal.prepare("phone", "receipt", BEGIN, "two")
    journal.report("phone", "receipt", "cancelled", "one")
    for change in ({"sha256": "b" * 64}, {"size": 9}, {"name": "b.bin"}):
        with pytest.raises(ValueError, match="原文件"):
            journal.prepare("phone", "receipt", {**BEGIN, **change}, "two")
    assert journal.snapshot()[0]["sha256"] == BEGIN["sha256"]


def test_incomplete_phone_reply_cannot_be_reconciled_as_success():
    journal = TransferJournal()
    journal.prepare("phone", "receipt", BEGIN, "one")
    journal.observe("phone", "receipt", {"operation": "chunk"}, {"offset": 8}, "one")
    with pytest.raises(ValueError, match="未确认"):
        journal.observe("phone", "receipt", {"operation": "complete"}, {"message": "ok"}, "one")
    assert journal.snapshot()[0]["state"] == "error"
    assert not journal.report("phone", "receipt", "done", "one")


def test_closed_browser_expires_without_losing_offset_and_retention_is_durable(
    tmp_path, monkeypatch
):
    now = time.time()
    monkeypatch.setattr("runtime.tentacle.transfer_journal.time.time", lambda: now)
    path = tmp_path / "transfers.sqlite3"
    journal = TransferJournal(path)
    journal.observe("phone", "receipt", BEGIN, {"offset": 4})
    now += 46
    assert journal.snapshot()[0]["state"] == "interrupted"
    journal.prepare("phone", "receipt", BEGIN, "new")
    assert journal.snapshot()[0]["bytes"] == 4
    now += 86401
    assert journal.snapshot() == []
    assert TransferJournal(path).snapshot() == []


def test_history_is_bounded_on_disk(tmp_path):
    path = tmp_path / "transfers.sqlite3"
    journal = TransferJournal(path)
    for index in range(105):
        journal.observe("phone", f"receipt-{index}", BEGIN, {"offset": 0})
    assert len(TransferJournal(path).snapshot()) == 100


def test_changed_phone_file_is_not_silently_reused_for_download():
    journal = TransferJournal()
    args = {"operation": "stat", "name": "a.bin"}
    journal.prepare("phone", "receipt", args, "one")
    journal.observe("phone", "receipt", args, {"size": 8, "sha256": "a" * 64}, "one")
    journal.report("phone", "receipt", "error", "one")
    journal.prepare("phone", "receipt", args, "two")
    with pytest.raises(ValueError, match="内容已改变"):
        journal.observe("phone", "receipt", args, {"size": 8, "sha256": "b" * 64}, "two")
    assert journal.snapshot()[0]["state"] == "error"


def test_http_aliases_recover_the_same_receipt_after_coordinator_restart(tmp_path):
    device = SimpleNamespace(
        is_online=True,
        platform="android",
        meta={"reported_capabilities": ["android.exchange_files"]},
    )
    send = AsyncMock(return_value=ToolResult.ok("call", {"id": "upload", "offset": 4}))

    def coordinator():
        return SimpleNamespace(
            transfer_journal_path=tmp_path / "transfers.sqlite3",
            pool=SimpleNamespace(get=lambda _: device),
            ws_server=SimpleNamespace(send_tool_execute=send),
        )

    current = coordinator()
    app = FastAPI()
    for prefix in ("/os", "/ai"):
        app.include_router(create_mirror_router(lambda: current), prefix=prefix)
    with TestClient(app) as client:
        args = {**BEGIN, "_transferId": "receipt", "_transferAttempt": "one"}
        assert client.post("/os/devices/phone/mirror/files", json=args).status_code == 200
        assert send.call_args.args[1].args == BEGIN  # gateway metadata never reaches the phone
        current = coordinator()
        job = client.post("/ai/devices/all/mirror/transfers", json={}).json()["jobs"][0]
        assert (job["id"], job["bytes"], job["state"]) == ("receipt", 4, "interrupted")
        response = client.post(
            "/ai/devices/phone/mirror/files", json={**args, "_transferAttempt": "two"}
        )
        assert response.status_code == 200
        stale = client.post(
            "/os/devices/phone/mirror/files",
            json={"operation": "chunk", "_transferId": "receipt", "_transferAttempt": "one"},
        )
        assert stale.status_code == 409
        assert send.call_count == 2
