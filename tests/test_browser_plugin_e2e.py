"""Real Chromium checks through the plugin's registered tools, on a local fixture.

No model, user browser, account, or external website is involved.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest

from runtime.execution.suckers import browser_session_worker, browser_skills
from runtime.execution.suckers.registry import SkillRegistry
from runtime.platform.plugins.automation import prepare_automation_plugins, register_managed_group
from runtime.platform.plugins.plugin_hub import PluginHub
from runtime.platform.process.session import Session, session_scope
from runtime.platform.runtime_policy import capabilities
from tests.conftest import requires_chromium

HTML = b"""<!doctype html><title>Echo automation fixture</title>
<label>Name <input id="name" value="Echo"></label>
<button id="save" onclick="document.querySelector('#result').textContent=
'Saved: '+document.querySelector('#name').value">Save</button>
<p id="result">Not saved</p>"""


@pytest.fixture
def browser_plugin(tmp_path, monkeypatch):
    requires_chromium()
    monkeypatch.delenv("ECHO_BROWSER_PROFILE", raising=False)
    # Never discover/control a user's connected browser from this test.
    monkeypatch.setattr(browser_skills, "_higher_track_backends", lambda: [])
    pool = browser_session_worker.BrowserSessionPool()
    monkeypatch.setattr(browser_session_worker, "get_browser_session_pool", lambda: pool)
    monkeypatch.setattr(capabilities, "_store_path", lambda: tmp_path / "capabilities.json")
    registry = SkillRegistry()
    hub = PluginHub(
        plugin_dir=tmp_path / "plugins",
        bundled_plugin_dir=Path(__file__).parents[1] / "runtime/platform/plugins/bundled",
        skill_registry=registry,
        activation_root=tmp_path / "activation",
        data_root=tmp_path / "data",
    )
    prepare_automation_plugins(registry, enable_web=True, hub=hub)
    register_managed_group(registry, "browser")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with session_scope(Session(thread_id="browser-plugin-e2e")):
            yield registry, hub, f"http://127.0.0.1:{server.server_port}/"
    finally:
        hub.disable_plugin("browser_control")
        pool.close_all()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_plugin_form_flow_recovers_and_revokes_old_tools(browser_plugin):
    registry, hub, url = browser_plugin

    def call(name, **kwargs):
        result = registry.get(name).handler(**kwargs)
        assert "error" not in result, result
        assert result["track"] == "playwright"
        return result

    assert call("browser_navigate", url=url, allow_private=True)["status_code"] == 200
    assert "Not saved" in call("browser_get")["content"]
    call("browser_type", selector="#name", text="Echo")
    # Appending must preserve the previously entered value across tool calls.
    call("browser_type", selector="#name", text=" Agent", clear_first=False)
    failed = registry.get("browser_click").handler(selector="#missing", timeout_ms=100)
    assert "error" in failed
    call("browser_click", selector="#save")
    assert "Saved: Echo Agent" in call("browser_get")["content"]
    cached = registry.get("browser_click").handler
    hub.disable_plugin("browser_control")
    with pytest.raises(RuntimeError, match="revoked"):
        cached(selector="#save")
    hub.enable_plugin("browser_control")
    with pytest.raises(RuntimeError, match="revoked"):
        cached(selector="#save")
    assert "Saved: Echo Agent" in call("browser_get")["content"]
