"""Real child process + real SQLite + HTTP; no mocked storage backend."""

import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.execution.suckers.registry import SkillRegistry
from runtime.platform.plugins.knowledge_storage import ManagedStorage
from runtime.platform.plugins.plugin_hub import PluginHub
from runtime.sensing.gateway.storage_proxy_router import create_storage_proxy_router


@pytest.fixture
def hub(tmp_path):
    registry = SkillRegistry()
    value = PluginHub(
        plugin_dir=tmp_path / "plugins",
        bundled_plugin_dir=Path(__file__).parents[1] / "runtime/platform/plugins/bundled",
        activation_root=tmp_path / "activation",
        data_root=tmp_path / "data",
        skill_registry=registry,
    )
    yield value, registry
    value.stop_all()
    value.unload_all()


def index(service, source_id):
    job = service.request("POST", "/v1/index/jobs", {"source_ids": [source_id]})
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        state = service.request("GET", f"/v1/index/jobs/{job['job_id']}")
        if state["status"] in ("complete", "failed"):
            assert state["status"] == "complete", state
            return
        time.sleep(0.1)
    pytest.fail("index timeout")


def test_install_chinese_search_upgrade_reinstall_and_revocation(hub, tmp_path):
    value, registry = hub
    detail = value.get_plugin_detail("knowledge_storage")
    assert not detail["installed"]
    assert not registry.has("search_documents")
    value.install_plugin("knowledge_storage")
    plugin = value.get_plugin("knowledge_storage")
    service = plugin.service
    assert service.request("GET", "/v1/policy")["mode"] == "privacy"
    docs = tmp_path / "中文目录"
    docs.mkdir()
    file = docs / "设计笔记.md"
    file.write_text("这份设计记录说明远控声音与断线恢复已经进入验收阶段。", encoding="utf-8")
    source = service.request("POST", "/v1/sources", {"path": str(docs)})
    index(service, source["source_id"])
    search = registry.get("search_documents").handler
    result = search(query="断线恢复")
    assert result["count"] == 1
    assert result["hits"][0]["citation"]["path"] == str(file)
    assert (
        service.request(
            "POST", "/v1/search", {"query": "断线恢复", "source_ids": ["unauthorized"]}
        )["hits"]
        == []
    )
    value.install_plugin("knowledge_storage")
    assert plugin is value.get_plugin("knowledge_storage")
    value.disable_plugin("knowledge_storage")
    assert not service.running and not registry.has("search_documents")
    with pytest.raises(RuntimeError, match="撤销"):
        search(query="断线恢复")
    value.upgrade_plugin("knowledge_storage")
    assert not value.get_plugin_detail("knowledge_storage")["enabled"]
    value.enable_plugin("knowledge_storage")
    value.upgrade_plugin("knowledge_storage")
    assert registry.get("search_documents").handler(query="断线恢复")["count"] == 1
    value.uninstall_plugin("knowledge_storage")
    assert (tmp_path / "data/knowledge-storage/storage.sqlite3").exists()
    assert file.exists()
    value.install_plugin("knowledge_storage")
    assert registry.get("search_documents").handler(query="断线恢复")["count"] == 1
    service = value.get_plugin("knowledge_storage").service
    file.write_text("修订记录说明中文输入已经完成。", encoding="utf-8")
    index(service, source["source_id"])
    assert not service.request("POST", "/v1/search", {"query": "断线恢复"})["hits"]
    assert service.request("POST", "/v1/search", {"query": "中文输入"})["hits"]
    file.unlink()
    index(service, source["source_id"])
    assert not service.request("POST", "/v1/search", {"query": "中文输入"})["hits"]


def test_private_proxy_no_disabled_bypass(hub, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("NO_PROXY", "")
    value, _ = hub
    app = FastAPI()
    app.state.plugin_hub = value
    app.include_router(create_storage_proxy_router())
    with TestClient(app) as client:
        assert client.get("/api/storage/v1/manifest").status_code == 503
        value.install_plugin("knowledge_storage")
        response = client.get("/api/storage/v1/manifest")
        assert response.status_code == 200
        assert response.json()["service"] == "echo-storage"
        assert "api_token" not in response.text
        value.disable_plugin("knowledge_storage")
        assert client.get("/api/storage/v1/manifest").status_code == 503


def test_independent_hosts_process_recovery_and_data_lease(tmp_path):
    first = ManagedStorage(tmp_path / "AI")
    second = ManagedStorage(tmp_path / "OS")
    same_data = ManagedStorage(tmp_path / "AI")
    try:
        first.start()
        second.start()
        assert first.endpoint()[0] != second.endpoint()[0]
        assert first.endpoint()[1] != second.endpoint()[1]
        with pytest.raises(RuntimeError, match="另一个应用"):
            same_data.start()
        first._process.kill()
        first._process.wait(5)
        assert not first.running
        first.start()
        assert first.request("GET", "/v1/manifest")["version"] == "0.2.0"
        first.stop()
        assert second.request("GET", "/v1/manifest")["version"] == "0.2.0"
    finally:
        first.stop()
        second.stop()
        same_data.stop()

def test_private_http_service_does_not_require_host_tls_store(tmp_path, monkeypatch):
    import ssl

    def unavailable_trust_store(*args, **kwargs):
        raise FileNotFoundError("host TLS store is unavailable")

    monkeypatch.setattr(ssl, "_create_default_https_context", unavailable_trust_store)
    service = ManagedStorage(tmp_path / "no-tls-store")
    try:
        service.start()
        assert service.request("GET", "/v1/manifest")["service"] == "echo-storage"
    finally:
        service.stop()


def test_private_http_does_not_follow_credentialed_redirects(tmp_path):
    import threading
    import urllib.error
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from unittest.mock import Mock

    requests = []

    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/credential-target")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    service = ManagedStorage(tmp_path)
    service._process = Mock(poll=lambda: None)
    service._url = f"http://127.0.0.1:{server.server_port}"
    service._token = "test-private-token"
    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            service.request("GET", "/v1/manifest")
        assert error.value.code == 302
        assert requests == ["/v1/manifest"]
    finally:
        server.shutdown()
        server.server_close()
        worker.join(5)

