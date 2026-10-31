"""Actual phone page and media through direct, real local TURN and WSS fallback.

Opt in with ECHO_REMOTE_MOBILE_ASSETS and ECHO_TEST_TURN_CONFIG pointing to a
JSON file containing udp/tcp RTCIceServer entries for a private test relay.
This does not deploy a relay or change production configuration.
"""

import asyncio
import contextlib
import json
import os
from functools import partial
from pathlib import Path

import pytest

from runtime.tentacle.remote_desktop import RemoteDesktopHost
from runtime.tentacle.transport.ws_server import TentacleWebSocketServer
from tests.test_remote_desktop import Input
from tests.test_remote_desktop_audio import Tone


def relay_sdp(sdp):
    return (
        "\r\n".join(
            line
            for line in sdp.splitlines()
            if not line.startswith("a=candidate:") or " typ relay" in line
        )
        + "\r\n"
    )


@pytest.mark.asyncio
@pytest.mark.timeout(180)
@pytest.mark.parametrize("scenario", ["direct", "turn-udp", "turn-tcp", "wss"])
async def test_phone_actual_selected_route_media_and_recovery(tmp_path, monkeypatch, scenario):
    assets = os.environ.get("ECHO_REMOTE_MOBILE_ASSETS")
    config_path = os.environ.get("ECHO_TEST_TURN_CONFIG")
    if not assets or not config_path:
        pytest.skip("Set private TURN config and phone assets for actual relay integration")
    from PIL import Image
    from playwright.async_api import async_playwright, expect
    from websockets.asyncio.client import connect

    from runtime.tentacle import remote_desktop_audio as audio
    from runtime.tentacle import remote_desktop_media as media

    config = json.loads(Path(config_path).read_text())["tcp" if scenario == "turn-tcp" else "udp"]
    if scenario == "wss":
        config = {**config, "credential": "deliberately-invalid-test-credential"}
    monkeypatch.setenv("ECHO_REMOTE_ICE_SERVERS", json.dumps([config]))
    monkeypatch.setattr(audio, "system_audio_available", lambda: True)

    class Capture:
        geometry = {"left": 0, "top": 0, "width": 160, "height": 90}

        def frame(self):
            return Image.new("RGB", (160, 90), (40, 80, 120))

        def close(self):
            pass

    class SafeInput(Input):
        def focus_hint(self):
            return {"available": True, "editable": True, "secure": False}

    class RoutedPeer(media.DesktopPeer):
        async def offer(self):
            offer = await super().offer()
            if scenario != "direct":
                offer["sdp"] = relay_sdp(offer["sdp"])
            return offer

    monkeypatch.setattr(
        media, "DesktopPeer", partial(RoutedPeer, capture_factory=Capture, audio_factory=Tone)
    )
    monkeypatch.setattr(
        media,
        "RelayedDesktopPeer",
        partial(media.RelayedDesktopPeer, capture_factory=Capture, audio_factory=Tone),
    )
    server = TentacleWebSocketServer(host="127.0.0.1", port=0, auth_token="route-test")
    host = RemoteDesktopHost(server, tmp_path / "grants.json", input_factory=SafeInput)
    server.on_custom, server.on_device_disconnect = host.handle, host.stop
    await server.start()
    phone = pump = None
    requests = []
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
                        "auth_token": "route-test",
                        "platform": "android",
                    },
                }
            )
        )
        assert json.loads(await phone.recv())["result"]["registered"]
        await host.grant("phone", "control")
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                channel=os.environ.get("ECHO_REMOTE_BROWSER_CHANNEL"),
                args=["--mute-audio", "--disable-features=WebRtcHideLocalIpsWithMdns"],
            )
            try:
                page = await browser.new_page(viewport={"width": 420, "height": 850})

                async def signal(text):
                    message = json.loads(text)
                    if message["method"] == "webrtc/request":
                        requests.append({k: message["params"][k] for k in ("transport", "iceMode")})
                    if scenario != "direct":
                        if message["method"] == "webrtc/answer":
                            message["params"]["sdp"] = relay_sdp(message["params"]["sdp"])
                        if (
                            message["method"] == "webrtc/candidate"
                            and " typ relay" not in message["params"]["candidate"]["candidate"]
                        ):
                            return True
                    await phone.send(json.dumps(message))
                    return True

                await page.expose_function("bridgeSignal", signal)

                async def sound(live=True):
                    async with asyncio.timeout(15):
                        while True:
                            rms = await page.evaluate("window.testRms()")
                            if (rms > 0.02) if live else (rms < 0.003):
                                return rms
                            await asyncio.sleep(0.1)

                await page.add_init_script("""(() => {
                  const Native=window.AudioContext;
                  window.AudioContext=class extends Native {
                    constructor(...args) {super(...args);window.testAudio=this;this.meter=this.createAnalyser();
                      this.meter.fftSize=2048;this.meter.connect(this.destination);
                      const make=this.createBufferSource.bind(this);this.createBufferSource=()=>{
                        const source=make(),connect=source.connect.bind(source);source.connect=()=>connect(this.meter);return source;};}
                  };
                  window.testRms=()=>{const ctx=window.testAudio;if(!ctx||ctx.state!=='running')return 0;
                    const stream=document.querySelector('#system-audio').srcObject;
                    if(ctx.measured!==stream){if(ctx.source)ctx.source.disconnect();ctx.measured=stream;
                      if(stream){ctx.source=ctx.createMediaStreamSource(stream);ctx.source.connect(ctx.meter);}}
                    const samples=new Float32Array(ctx.meter.fftSize);ctx.meter.getFloatTimeDomainData(samples);
                    return Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length);};
                })();""")
                await page.add_init_script("""window.Android={signal:t=>window.bridgeSignal(t),ready:()=>window.remoteConnection(true),
                  reconnect:()=>{},back:()=>{},showKeyboard:()=>{},hideKeyboard:()=>{},supportsMiniPlayer:()=>false};""")
                await page.goto((Path(assets) / "pc_remote.html").as_uri())

                async def receive():
                    async for text in phone:
                        await page.evaluate("m=>window.remoteSignal(m)", json.loads(text))

                pump = asyncio.create_task(receive())
                path = "direct" if scenario == "direct" else "wss" if scenario == "wss" else "turn"
                label = {"direct": "直连", "turn": "TURN 中继", "wss": "WSS 兼容连接"}[path]
                await expect(page.locator("#st")).to_contain_text(label, timeout=85000)
                async with asyncio.timeout(10):
                    while host.status()["active"][0]["connectionPath"] != path:
                        await asyncio.sleep(0.1)
                initial_requests = list(requests)
                assert initial_requests[0] == {"transport": "webrtc", "iceMode": "direct"}
                if scenario != "direct":
                    assert initial_requests[1] == {"transport": "webrtc", "iceMode": "relay"}
                if scenario == "wss":
                    assert initial_requests[2]["transport"] == "relay"
                else:
                    assert len(initial_requests) == (1 if scenario == "direct" else 2)
                assert await page.evaluate(
                    "document.querySelector('#v').videoWidth>0 || document.querySelector('#relay-frame').naturalWidth>0"
                )
                await page.locator("#btn-kb").click()
                await page.locator("#kbi").fill("直连与中继 中文🌏")
                await page.locator("#btn-send-type").click()
                await expect(page.locator("#kbi")).to_have_value("")
                assert host.sessions["phone"].input.events[-1]["text"] == "直连与中继 中文🌏"
                await page.locator("#btn-actions").click()
                await page.locator("#btn-audio").click()
                await expect(page.locator("#audio-note")).to_contain_text("正在播放", timeout=35000)
                await expect(page.locator("#st")).to_contain_text(label, timeout=15000)
                assert requests[-1] == initial_requests[-1]
                audio_rms = await sound()
                # A real host-side session termination restarts direct discovery, then recovers.
                if scenario in {"direct", "turn-udp"}:
                    retired = host.sessions["phone"]
                    recovery_index = len(requests)
                    await host.stop("phone", "connection_lost")
                    async with asyncio.timeout(65):
                        while (
                            host.sessions.get("phone") is None
                            or host.sessions["phone"] is retired
                            or host.sessions["phone"].state != "connected"
                            or host.status()["active"][0]["connectionPath"] != path
                        ):
                            await asyncio.sleep(0.1)
                    assert requests[recovery_index] == {"transport": "webrtc", "iceMode": "direct"}
                    await expect(page.locator("#st")).to_contain_text(label, timeout=50000)
                    await expect(page.locator("#audio-note")).to_contain_text(
                        "正在播放", timeout=15000
                    )
                    await sound()
                proof_dir = os.environ.get("ECHO_ROUTING_EVIDENCE")
                if proof_dir:
                    evidence = Path(proof_dir)
                    evidence.mkdir(parents=True, exist_ok=True)
                    await page.screenshot(path=str(evidence / f"{scenario}.png"))
                    (evidence / f"{scenario}.json").write_text(
                        json.dumps(
                            {
                                "passed": True,
                                "scenario": scenario,
                                "path": path,
                                "requests": requests,
                                "screen_arrived": True,
                                "unicode_ack": True,
                                "audio_playing": True,
                                "decoded_audio_rms": audio_rms,
                                "session_recovery": scenario in {"direct", "turn-udp"},
                                "physical_wan": False,
                                "android_hardware": False,
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                await asyncio.wait_for(host.stop("phone", "operator_stopped"), 10)
                await expect(page.locator("#st")).to_have_text("未连接")
                await sound(False)
                assert not host.sessions
            finally:
                await asyncio.wait_for(browser.close(), 10)
    finally:
        if pump:
            pump.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pump
        if phone:
            await phone.close()
        await asyncio.wait_for(host.shutdown(), 10)
        await asyncio.wait_for(server.stop(), 10)
