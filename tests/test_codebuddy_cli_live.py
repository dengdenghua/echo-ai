import asyncio
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.execution import codebuddy_backend as backend
from runtime.execution.request import ExecutionRequest, ExecutionResources, ExecutionTask
from runtime.execution.tool_engine.host_mcp import HostMCPBridge
from runtime.platform.process.scope import ExecutionScope
from runtime.platform.process.session import Session

requests = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        tools = [t.get("function", {}).get("name") for t in data.get("tools", [])]
        requests.append(tools)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        result = any(m.get("role") == "tool" for m in data.get("messages", []))
        if result:
            delta, finish = {"content": "ECHO_HOST_TOOL_OK_7d99"}, "stop"
        elif "mcp__echo__echo_probe" in tools:
            delta = {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": "probe_call",
                        "type": "function",
                        "function": {"name": "mcp__echo__echo_probe", "arguments": "{}"},
                    }
                ]
            }
            finish = "tool_calls"
        else:
            delta, finish = {"content": "No host tool was sent to the model."}, "stop"
        for choice in [
            {"delta": delta, "finish_reason": None},
            {"delta": {}, "finish_reason": finish},
        ]:
            chunk = {
                "id": "chatcmpl-probe",
                "object": "chat.completion.chunk",
                "created": 0,
                "model": "echo-integration",
                "choices": [{"index": 0, **choice}],
            }
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")


class Broker:
    def __init__(self):
        self.calls = 0
        self.catalog = SimpleNamespace(
            specs=[
                {
                    "name": "echo_probe",
                    "description": "Return a receipt.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                }
            ]
        )

    def bind_inner_scope(self, **_kwargs):
        pass

    def _interrupted(self):
        return False

    def close(self):
        pass

    async def invoke(self, tool, args, **_kwargs):
        assert tool == "echo_probe"
        self.calls += 1
        return {
            "success": True,
            "contentItems": [{"type": "inputText", "text": "ECHO_HOST_TOOL_OK_7d99"}],
        }


async def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="echo-cb-probe-") as folder:
            root = Path(folder)
            os.environ["CODEBUDDY_CONFIG_DIR"] = folder
            (root / "models.json").write_text(
                json.dumps(
                    {
                        "models": [
                            {
                                "id": "echo-integration",
                                "name": "Echo transport test",
                                "vendor": "OpenAI",
                                "apiKey": "test-only",
                                "url": f"http://127.0.0.1:{server.server_port}/v1/chat/completions",
                                "supportsToolCall": True,
                                "maxInputTokens": 100000,
                                "maxOutputTokens": 1000,
                            }
                        ]
                    }
                )
            )
            task = ExecutionTask(
                task_id="smoke",
                thread_id="smoke",
                actor_id=None,
                tenant_id=None,
                goal="Verify MCP transport",
                permissions=ExecutionScope(
                    mode="ask",
                    requested_mode="ask",
                    readable_roots=(root,),
                    writable_roots=(),
                    network_policy="deny",
                    shell_policy="deny",
                ),
                resources=ExecutionResources(1000, 1.0, time.monotonic() + 50),
                execution_engine="codebuddy",
                approval_provider=None,
            )
            session = Session(
                actor=None,
                agent=None,
                thread_id="smoke",
                turn_id="smoke",
                metadata={"workspace_path": folder},
            )
            broker = Broker()
            bridge = HostMCPBridge(broker, ExecutionRequest(task, task.goal), session)
            async with asyncio.timeout(50), bridge.serve() as connection:
                async for event in backend.stream_prompt(
                    text="Call the host tool and return its receipt.",
                    system="Integration check.",
                    model="custom-local:echo-integration",
                    interrupted=lambda: False,
                    host_mcp=connection,
                    tool_names={"mcp__echo__echo_probe": "probe"},
                ):
                    last_event = event
            assert broker.calls == 1
            assert requests == [["mcp__echo__echo_probe"], ["mcp__echo__echo_probe"]]
            assert last_event["type"] == "react_completed"
    finally:
        server.shutdown()


@pytest.mark.integration
@pytest.mark.skipif(os.environ.get("ECHO_CODEBUDDY_LIVE") != "1", reason="opt-in official CLI test")
def test_official_cli_calls_only_the_host_tool(tmp_path, monkeypatch):
    if not backend.executable():
        pytest.skip("CodeBuddy CLI is not installed")
    requests.clear()
    monkeypatch.setenv("CODEBUDDY_CONFIG_DIR", str(tmp_path))
    asyncio.run(main())
