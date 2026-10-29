"""Run the actual phone HTML against the authenticated host; opt in with the mobile assets path."""

import asyncio
import contextlib
import json
import os
from functools import partial
from pathlib import Path

import pytest

from runtime.tentacle.remote_desktop import RemoteDesktopHost
from runtime.tentacle.transport.ws_server import TentacleWebSocketServer
from tests.test_remote_desktop import Input, wait_for


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["webrtc", "relay"])
async def test_phone_page_frame_unicode_and_disconnect(tmp_path, monkeypatch, transport):
    assets = os.environ.get("ECHO_REMOTE_MOBILE_ASSETS")
    if not assets:
        pytest.skip(
            "Set ECHO_REMOTE_MOBILE_ASSETS to echo-mobile/app/src/main/assets for cross-repo UI verification"
        )
    from PIL import Image
    from playwright.async_api import async_playwright, expect
    from websockets.asyncio.client import connect

    from runtime.tentacle import remote_desktop_media as media

    class Capture:
        geometry = {"left": 0, "top": 0, "width": 160, "height": 90}

        def frame(self):
            return Image.new("RGB", (160, 90), (40, 80, 120))

        def close(self):
            pass

    class BrowserInput(Input):
        editable = True
        secure = False

        def focus_hint(self):
            return {"available": True, "editable": self.editable, "secure": self.secure}

    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", "[]")
    monkeypatch.setattr(
        media, "RelayedDesktopPeer", partial(media.RelayedDesktopPeer, capture_factory=Capture)
    )
    server = TentacleWebSocketServer(host="127.0.0.1", port=0, auth_token="test-phone-token")
    host = RemoteDesktopHost(
        server,
        tmp_path / "grants.json",
        input_factory=BrowserInput,
        peer_factory=partial(media.DesktopPeer, capture_factory=Capture)
        if transport == "webrtc"
        else None,
    )
    server.on_custom, server.on_device_disconnect = host.handle, host.stop
    await server.start()
    phone = pump = browser = None
    try:
        port = server._server.sockets[0].getsockname()[1]
        phone = await connect(f"ws://127.0.0.1:{port}")
        await phone.send(
            json.dumps(
                {
                    "method": "device/hello",
                    "id": "hello",
                    "params": {
                        "tentacle_id": "phone",
                        "auth_token": "test-phone-token",
                        "platform": "android",
                    },
                }
            )
        )
        assert json.loads(await phone.recv())["result"]["registered"]
        await host.grant("phone", "control")
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, channel=os.environ.get("ECHO_REMOTE_BROWSER_CHANNEL"),
                args=["--disable-features=WebRtcHideLocalIpsWithMdns"],
            )
            page = await browser.new_page(viewport={"width": 420, "height": 850})

            async def signal(text):
                message = json.loads(text)
                if message["method"] == "webrtc/request" and transport == "relay":
                    message["params"]["transport"] = "relay"
                await phone.send(json.dumps(message))
                return True

            await page.expose_function("bridgeSignal", signal)
            await page.add_init_script("""window.Android = {
                signal: text => window.bridgeSignal(text),
                ready: () => window.remoteConnection(true), reconnect: () => {}, back: () => {},
                showKeyboard: () => { window.keyboardRequests = (window.keyboardRequests || 0) + 1; },
                hideKeyboard: () => {}, supportsMiniPlayer: () => true,
                miniPlayer: () => window.remoteMini(true)
            };""")
            await page.goto((Path(assets) / "pc_remote.html").as_uri())
            assert await page.evaluate("typeof window.remoteSignal === 'function'")

            async def receive():
                async for text in phone:
                    await page.evaluate("message => window.remoteSignal(message)", json.loads(text))

            pump = asyncio.create_task(receive())
            await expect(page.locator("#st")).to_contain_text("可控制", timeout=30000)
            session = host.sessions["phone"]
            assert session.transport == transport
            await page.locator("#wrap").click(position={"x": 100, "y": 120})
            await expect(page.locator("#kb")).to_be_visible()
            assert await page.evaluate("window.keyboardRequests") == 1
            await page.locator("#kbi").fill("中文输入 Echo 🌏")
            await page.locator("#btn-send-type").click()
            await expect(page.locator("#kbi")).to_have_value("")
            assert session.input.events[-1]["text"] == "中文输入 Echo 🌏"
            await page.locator("#tab-keys").click()
            await page.locator('[data-modifier="ctrl"]').click()
            await page.locator('[data-key="a"]').click()
            await wait_for(lambda: session.input.events[-1].get("text") == "ctrl+a")
            await page.locator('[data-key="b"]').click()
            await wait_for(lambda: session.input.events[-1].get("text") == "b")
            await expect(page.locator('[data-modifier="ctrl"]')).to_have_attribute("aria-pressed", "false")
            await page.locator("#btn-kb-close").click()
            await page.locator("#wrap").click(position={"x": 100, "y": 120})
            await expect(page.locator("#kb")).to_be_visible()
            session.input.editable = False
            await page.locator("#btn-mouse").click()
            await page.locator("#mouse-left").click()
            await wait_for(lambda: session.input.events[-1]["action"] == "tap")
            await expect(page.locator("#mouse-panel")).to_be_visible()
            await page.mouse.move(100, 120)
            await page.mouse.down()
            await page.mouse.move(150, 145, steps=3)
            await page.mouse.up()
            await wait_for(lambda: any(e["action"] == "move" for e in session.input.events))
            await page.locator("#mouse-drag").click()
            await wait_for(lambda: session.input.events[-1]["action"] == "down")
            await page.locator("#btn-mouse-close").click()
            await wait_for(lambda: session.input.events[-1]["action"] == "up")
            await page.locator("#btn-actions").click()
            await page.locator("#btn-mini").click()
            before = len(session.input.events)
            await page.mouse.click(100, 120)
            await page.evaluate("document.querySelector('#btn-enter').click()")
            await asyncio.sleep(.15)
            assert len(session.input.events) == before
            await page.evaluate("window.remoteMini(false)")
            await page.locator("#btn-kb").click()
            await page.locator("#kbi").fill("切换画质保留的草稿")
            await page.locator("#btn-actions").click()
            old_session = session
            await page.locator("#quality").select_option("sharp")
            await expect(page.locator("#st")).to_contain_text("可控制", timeout=30000)
            await wait_for(lambda: "phone" in host.sessions and host.sessions["phone"] is not old_session and host.sessions["phone"].state == "connected")
            session = host.sessions["phone"]
            assert session.quality == "sharp" and old_session.peer.closed
            assert await page.locator("#kbi").input_value() == "切换画质保留的草稿"
            assert not any(e["action"] == "type" for e in session.input.events)
            await page.locator("#btn-kb").click()
            # Preserve unsent text, release input and end capture at the connection boundary.
            await page.locator("#kbi").fill("断线时保留的文字")
            await phone.close()
            await page.evaluate("window.remoteConnection(false)")
            await wait_for(lambda: session.peer.closed and session.input.released)
            assert await page.locator("#kbi").input_value() == "断线时保留的文字"
            assert await page.locator("#btn-send-type").is_disabled()
            assert not host.sessions
            await browser.close()
            browser = None
    finally:
        if pump:
            pump.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pump
        if phone:
            await phone.close()
        await host.shutdown()
        await server.stop()
