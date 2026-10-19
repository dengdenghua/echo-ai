"""Verify lock exclusion and error handling against an explicit running test PID."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import win32api
import win32event
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def run(pid, output):
    root = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(command=sys.executable, args=[str(root / "run_server.py")], cwd=str(root),
                                  env={k: os.environ[k] for k in ("OSG_LICENSE_FILE", "SNPSLMD_LICENSE_FILE", "LM_LICENSE_FILE") if k in os.environ})
    report = {"checks": [], "result": "PASS"}
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            await client.initialize()

            async def job(name, args, fail=False):
                response = await client.call_tool(name, args)
                assert not response.isError, response
                state = response.structuredContent or json.loads(response.content[0].text)
                for _ in range(400):
                    if state["status"] not in ("queued", "running"):
                        break
                    await asyncio.sleep(.2)
                    response = await client.call_tool("lt_job_status", {"job_id": state["job_id"]})
                    state = response.structuredContent or json.loads(response.content[0].text)
                assert state["status"] == ("failed" if fail else "completed"), state
                return state

            current = (await job("lt_connect", {"pid": pid}))["result"]
            context = {"pid": pid, "expected_view": current["active_view"]}
            started = (await job("lt_start", {}))["result"]
            assert started["pid"] == pid
            report["checks"].append("lt_start reuses the single running session")
            mutex = win32event.CreateMutex(None, False, rf"Local\Codex.LightToolsControl.{pid}")
            assert win32event.WaitForSingleObject(mutex, 0) == win32event.WAIT_OBJECT_0
            try:
                blocked = await job("lt_db_get", {**context, "key": "LENS_MANAGER[1]", "field": "UNITS"}, fail=True)
                assert not blocked["mutation_started"]
                assert "Another LightTools MCP job" in blocked["error"]["message"]
            finally:
                win32event.ReleaseMutex(mutex)
                win32api.CloseHandle(mutex)
            assert (await job("lt_db_get", {**context, "key": "LENS_MANAGER[1]", "field": "UNITS"}))["result"]["value"]
            report["checks"].append("cross-process mutex excludes conflicting work, and recovers after release")
            refused = await job("lt_command", {**context, "command": "New3DDesign"}, fail=True)
            assert not refused["mutation_started"]
            report["checks"].append("generic command cannot bypass replacement backup")
            invalid = await job("lt_db_get", {**context, "key": "RECEIVER[1].MESH[1]", "field": "CellFlux", "i": 0, "j": 0}, fail=True)
            assert invalid["error"]["type"] == "ValueError"
            json.dumps(invalid, allow_nan=False)
            valid = await job("lt_db_get", {**context, "key": "RECEIVER[1].MESH[1]", "field": "CellFlux", "i": 1, "j": 1})
            assert valid["result"]["value"] > 0
            report["checks"].append("vendor NaN with status 0 becomes a JSON-safe failed job; subsequent reads still work")

            # License availability for the connected process does not guarantee
            # that another GUI instance can obtain a Core license.
            response = await client.call_tool("lt_start", {"new_session": True})
            state = response.structuredContent or json.loads(response.content[0].text)
            for _ in range(400):
                if state["status"] not in ("queued", "running"):
                    break
                await asyncio.sleep(.2)
                response = await client.call_tool("lt_job_status", {"job_id": state["job_id"]})
                state = response.structuredContent or json.loads(response.content[0].text)
            test_pid = state["pid"]
            if state["status"] == "failed":
                assert "license manager" in state["error"]["message"], state
                report["isolated_startup"] = {"status": "blocked_by_vendor_license", "job": state}
                report["checks"].append("license-rejected isolated startup is reported as failed, never as successful")
                # Close only this test's rejected, newly created process windows.
                import win32gui, win32process
                handles = []
                def collect(hwnd, _):
                    _, owner = win32process.GetWindowThreadProcessId(hwnd)
                    if owner == test_pid:
                        handles.append((win32gui.GetClassName(hwnd), hwnd))
                win32gui.EnumWindows(collect, None)
                for cls, hwnd in handles:
                    if cls in ("#32770", "ORALTClass"):
                        win32gui.PostMessage(hwnd, 0x0010, 0, 0)
                await asyncio.sleep(1)
                Path(output).write_text(json.dumps(report, indent=2), encoding="utf-8")
                print(json.dumps(report, indent=2))
                return
            assert state["status"] == "completed", state
            isolated = state["result"]
            assert test_pid != pid and isolated["model_units"]
            blank = (await job("lt_objects", {"pid": test_pid, "expected_view": isolated["active_view"], "kind": "SOLID"}))["result"]
            assert blank["count"] == 0
            report["isolated_startup"] = {"status": "completed", "pid": test_pid}
            report["checks"].append("isolated launch waits for the initial model and binds the newly started PID")
            # Clean up only the isolated, empty process this test just created.
            import pythoncom
            import win32com.client
            import win32com.client.dynamic
            pythoncom.CoInitialize()
            try:
                raw, status = win32com.client.dynamic.Dispatch("LTCOM64.JSNET").GetLTAPI4FromPID(test_pid)
                assert status == 0
                lt = win32com.client.gencache.EnsureDispatch(raw)
                assert lt.GetServerID() == test_pid
                assert lt.Cmd("Exit") == 0
            finally:
                pythoncom.CoUninitialize()
    Path(output).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    asyncio.run(run(args.pid, args.output))
