"""Exercise the real stdio protocol. --live builds/traces a backed-up test model."""

import argparse
import asyncio
import csv
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def run(args):
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {"started_at": datetime.now().astimezone().isoformat(), "checks": [], "jobs": []}
    params = StdioServerParameters(command=sys.executable, args=[str(root / "run_server.py")], cwd=str(root),
                                  env={k: os.environ[k] for k in ("OSG_LICENSE_FILE", "SNPSLMD_LICENSE_FILE", "LM_LICENSE_FILE") if k in os.environ})
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            initialized = await client.initialize()
            report["server"] = initialized.serverInfo.model_dump()
            discovered = (await client.list_tools()).tools
            names = {tool.name for tool in discovered}
            assert len(names) == 18, names
            handle_reader = next(tool for tool in discovered if tool.name == "lt_read_object_fields")
            assert handle_reader.annotations.readOnlyHint is True
            assert {"kind", "fields", "pid", "expected_view"} <= set(handle_reader.inputSchema["required"])
            report["checks"].append("stdio discovery: 18 tools; bounded native-handle reader marked readonly")

            async def call(name, data):
                response = await client.call_tool(name, data)
                assert not response.isError, (name, response)
                return response.structuredContent or json.loads(response.content[0].text)

            async def job(name, data, failure=False, timeout=120):
                state = await call(name, data)
                until = time.monotonic() + timeout
                while state["status"] in ("queued", "running"):
                    assert time.monotonic() < until, "Job still running; do not repeat this operation"
                    await asyncio.sleep(.25)
                    state = await call("lt_job_status", {"job_id": state["job_id"]})
                report["jobs"].append(state)
                assert state["status"] == ("failed" if failure else "completed"), state
                return state if failure else state["result"]

            env = await call("lt_environment", {})
            report["environment"] = env
            doc = await call("lt_docs_search", {"query": "GetMeshData"})
            assert doc["total_matches"] >= 1
            page = await call("lt_docs_read", {"filename": "apirg3.04.38.html"})
            assert "BeginAllSimulations" in page["text"]
            report["checks"].append("installed vendor documentation search and retrieval")
            if not args.live:
                report["result"] = "PASS (protocol and docs only)"
            else:
                if args.pid:
                    connection = await job("lt_connect", {"pid": args.pid})
                else:
                    connection = await job("lt_start", {"new_session": True})
                pid, view = connection["pid"], connection["active_view"]
                report["test_pid"] = pid
                replacement = await job("lt_new_model", {"pid": pid, "expected_view": view})
                view = replacement["active_view"]
                assert Path(replacement["previous_model_backup"]).stat().st_size > 0
                context = {"pid": pid, "expected_view": view}
                wrong_view = await job("lt_command", {"pid": pid, "expected_view": "stale-view",
                                       "command": "Block3Pt XYZ 0,0,0 XYZ 0,1,0 XYZ 0,0,1"}, failure=True)
                assert not wrong_view["mutation_started"]
                report["checks"].append("stale view rejected before mutation; replacement recovery copy exists")

                # The block is placed away from the optical path.
                await job("lt_command", {**context, "command": "Block3Pt XYZ 10,10,10 XYZ 10,11,10 XYZ 10,10,11"})
                renamed = await job("lt_db_set", {**context, "key": "SOLID[@Last]", "field": "Name",
                                    "value": "CodexSmokeBlock"})
                assert renamed["value"] == "CodexSmokeBlock"
                objects = await job("lt_objects", {**context, "kind": "SOLID"})
                assert any(item["name"] == "CodexSmokeBlock" for item in objects["objects"])
                report["checks"].append("geometry creation, parameter write/readback, and object enumeration")
                schema = await job("lt_schema", {**context, "key": "LENS_MANAGER[1]"})
                (output / "model-schema.txt").write_text(schema["text"], encoding="utf-8")

                # Model setup follows the installed APIReferenceGuide GetMeshData example.
                for command in ("DiskSource XYZ 0,0,-1 XYZ 0,.1,-1 XYZ 0,0,0",
                                "DummyPlane XYZ 0,.5,2 XYZ 0,.5,3",
                                '\\OPLANE_DUMMY_SURFACE[1] "Add_Receiver"= \\Q'):
                    await job("lt_command", {**context, "command": command})
                await job("lt_db_set", {**context, "key": "SOURCE[1].AIM_SPHERE[@Last]",
                          "field": "Lower_Angle", "value": 10})
                # Rectangular meshes catch accidental axis swaps that square meshes hide.
                for field, value in (("X_Dimension", 8), ("Y_Dimension", 5)):
                    await job("lt_db_set", {**context, "key": "RECEIVER[1].MESH[1]", "field": field, "value": value})
                await job("lt_ray_trace", context)
                mesh = await job("lt_receiver_mesh", context)
                assert mesh["x_dimension"] == 8 and mesh["y_dimension"] == 5
                assert mesh["sum"] > 0 and mesh["total_power"] > 0
                # Mesh estimates need not exactly equal native incident power.
                # Verify the array against independently indexed API readings,
                # and preserve/check the vendor's own total-flux error metric.
                indexed_sum = 0.0
                for i in range(1, 9):
                    for j in range(1, 6):
                        cell = await job("lt_db_get", {**context, "key": "RECEIVER[1].MESH[1]",
                                         "field": "CellFlux", "i": i, "j": j})
                        indexed_sum += cell["value"]
                assert abs(mesh["sum"] - indexed_sum) < 1e-12
                assert abs(mesh["flux_difference_percent"] - mesh["reported_total_flux_error_percent"]) < 1e-8
                report["mesh"] = mesh
                report["checks"].append("ray trace completed; bulk mesh equals 40 indexed API readings; flux difference matches the native error metric")
                csv_path = str(output / "receiver-flux.csv")
                exported = await job("lt_export_mesh_csv", {**context, "csv_path": csv_path})
                with open(csv_path, newline="", encoding="utf-8") as stream:
                    rows = list(csv.reader(stream))
                assert [len(rows), len(rows[0])] == exported["returned_shape"]
                assert sum(len(row) for row in rows) == 40
                report["checks"].append("CSV preserves the vendor mesh shape and all 40 cells")

                path = output / "smoke-model.lts"
                saved = await job("lt_save_copy", {**context, "path": str(path)})
                path = Path(saved["path"])
                view = saved["active_view"]
                context["expected_view"] = view
                before = hashlib.sha256(path.read_bytes()).hexdigest()
                refusal = await job("lt_save_copy", {**context, "path": str(path)}, failure=True)
                assert not refusal["mutation_started"]
                assert hashlib.sha256(path.read_bytes()).hexdigest() == before
                report["checks"].append("native .lts saved; overwrite refused before mutation")
                reopened = await job("lt_open_model", {**context, "path": str(path)})
                context["expected_view"] = reopened["active_view"]
                name = await job("lt_db_get", {**context, "key": "SOLID[CodexSmokeBlock]", "field": "Name"})
                assert name["value"] == "CodexSmokeBlock"
                report["checks"].append("saved model reopened with geometry retained and previous state backed up")
                report["model_path"] = str(path)
                report["result"] = "PASS"
    (output / "test-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "jobs"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--pid", type=int, help="Use an explicitly chosen test PID instead of launching an isolated session")
    parser.add_argument("--output", required=True, help="Use a new output directory for live tests")
    asyncio.run(run(parser.parse_args()))
