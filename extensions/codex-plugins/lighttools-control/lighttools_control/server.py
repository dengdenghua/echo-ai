"""STDIO MCP entry point; stdout belongs exclusively to the protocol."""

import sys
import os
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import Settings
from mcp.types import ToolAnnotations

from .bridge import Jobs, processes
from .docs import installation, read_doc, search_docs

INSTRUCTIONS = (
    "Control local LightTools through LTAPI4. First list sessions, then connect to an explicit PID. "
    "Every COM operation returns a job_id; poll lt_job_status until completed or failed. "
    "Use the active_view returned by lt_connect as expected_view; a changed view is rejected. "
    "Never automatically repeat a failed or timed-out mutation. Save to a new .lts path. "
    "Open/new replace the current system and first save a recovery copy. Use lt_start(new_session=True) for isolation. "
    "Model lengths use the current model units: inspect them before entering geometry. "
    "Read the installed API/command documentation for unfamiliar commands."
)
# SDK 1.26 defines Settings before FastMCP. Resolve its forward reference before
# newer pydantic-settings tries to inspect environment-variable fields.
Settings.model_rebuild()
mcp = FastMCP("LightTools Control", instructions=INSTRUCTIONS, log_level="WARNING")
jobs = Jobs()
READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
COMMAND = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=False)


@mcp.tool(annotations=READ)
def lt_environment() -> dict:
    """List installed LightTools and running PIDs without connecting or launching it."""
    root = installation()
    return {"installation": str(root), "processes": processes(), "api": "LTAPI4/COM",
            "license_environment_present": [k for k in ("OSG_LICENSE_FILE", "SNPSLMD_LICENSE_FILE", "LM_LICENSE_FILE") if os.environ.get(k)],
            "server_version": "0.1.0", "official_vendor_product": False}


@mcp.tool(annotations=WRITE)
def lt_start(new_session: bool = False) -> dict:
    """Launch LightTools once if absent, or query the only running session. Returns a job_id."""
    return jobs.submit("start", new_session=new_session)


@mcp.tool(annotations=READ)
def lt_connect(pid: int) -> dict:
    """Verify an explicit PID and return version, active_view and license state as a job."""
    return jobs.submit("connect", pid=pid)


@mcp.tool(annotations=READ)
def lt_job_status(job_id: str) -> dict:
    """Read job status without blocking on COM. Only completed confirms success."""
    return jobs.snapshot(job_id)


@mcp.tool(annotations=WRITE)
def lt_new_model(pid: int, expected_view: str) -> dict:
    """Back up the current system, then replace it with a blank 3D model. For isolation start a new session."""
    return jobs.submit("new", pid, expected_view)


@mcp.tool(annotations=WRITE)
def lt_open_model(pid: int, expected_view: str, path: str) -> dict:
    """Back up the current system, then replace it by opening an existing absolute .lts file."""
    return jobs.submit("open", pid, expected_view, path=path)


@mcp.tool(annotations=WRITE)
def lt_save_copy(pid: int, expected_view: str, path: str) -> dict:
    """SaveAs to a new absolute .lts path. Existing output files are rejected."""
    return jobs.submit("save", pid, expected_view, path=path)


@mcp.tool(annotations=READ)
def lt_db_get(pid: int, expected_view: str, key: str, field: str, i: int = -1, j: int = -1) -> dict:
    """Read a model datum with checked status. Optional i/j are the vendor API indices."""
    return jobs.submit("get", pid, expected_view, key=key, field=field, i=i, j=j)


@mcp.tool(annotations=WRITE)
def lt_db_set(pid: int, expected_view: str, key: str, field: str, value: str | float | int | bool,
              i: int = -1, j: int = -1) -> dict:
    """Set a model datum, check its status, and read back the value. Returns a job_id."""
    return jobs.submit("set", pid, expected_view, key=key, field=field, value=value, i=i, j=j)


@mcp.tool(annotations=READ)
def lt_objects(pid: int, expected_view: str, root: str = "LENS_MANAGER[1]", kind: str = "SOLID",
               limit: int = 100) -> dict:
    """List model objects using DbList, returning their database paths and names."""
    if not 1 <= limit <= 500:
        raise ValueError("limit must be 1 to 500")
    return jobs.submit("objects", pid, expected_view, root=root, kind=kind, limit=limit)


@mcp.tool(annotations=READ)
def lt_read_object_fields(pid: int, expected_view: str, kind: str, fields: list[str],
                          root: str = "LENS_MANAGER[1]", limit: int = 100,
                          compare_paths: bool = False, i: int = -1, j: int = -1) -> dict:
    """Read bounded fields through native list handles. Check each field's API status; optionally compare paths."""
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("limit must be 1 to 100")
    if not 1 <= len(fields) <= 10 or any(not field.strip() or len(field) > 100 for field in fields):
        raise ValueError("Provide 1 to 10 nonblank fields, each at most 100 characters")
    if len(set(fields)) != len(fields):
        raise ValueError("Field names must be unique")
    if not root.strip() or len(root) > 4000 or not kind.strip() or len(kind) > 100:
        raise ValueError("Provide a bounded root and filter")
    return jobs.submit("read_object_fields", pid, expected_view, root=root, kind=kind,
                       fields=fields, limit=limit, compare_paths=compare_paths, i=i, j=j)


@mcp.tool(annotations=READ)
def lt_read_child_fields(pid: int, expected_view: str, parent_kind: str,
                         parent_fields: list[str], child_kind: str, child_fields: list[str],
                         root: str = "LENS_MANAGER[1]", parent_limit: int = 10,
                         child_limit: int = 100, parent_offset: int = 0) -> dict:
    """Read parent-bound child data through nested live handles; paths are display only."""
    if type(parent_limit) is not int or not 1 <= parent_limit <= 10:
        raise ValueError("parent_limit must be 1 to 10")
    if type(child_limit) is not int or not 1 <= child_limit <= 5000:
        raise ValueError("child_limit must be 1 to 5000")
    if type(parent_offset) is not int or not 0 <= parent_offset <= 50000:
        raise ValueError("parent_offset must be 0 to 50000 skipped parent items")
    for names in (parent_fields, child_fields):
        if not 1 <= len(names) <= 10 or any(not name.strip() or len(name) > 100 for name in names):
            raise ValueError("Provide 1 to 10 nonblank fields, at most 100 characters each")
        if len(set(names)) != len(names):
            raise ValueError("Field names must be unique")
    if not root.strip() or len(root) > 4000:
        raise ValueError("Provide a bounded root")
    if any(not kind.strip() or len(kind) > 100 for kind in (parent_kind, child_kind)):
        raise ValueError("Provide bounded parent and child filters")
    if parent_limit * child_limit * len(child_fields) > 50000:
        raise ValueError("At most 50000 child field reads per call")
    return jobs.submit("read_child_fields", pid, expected_view, root=root,
                       parent_kind=parent_kind, parent_fields=parent_fields,
                       child_kind=child_kind, child_fields=child_fields,
                       parent_limit=parent_limit, child_limit=child_limit, parent_offset=parent_offset)


@mcp.tool(annotations=READ)
def lt_schema(pid: int, expected_view: str, key: str) -> dict:
    """Read available data elements using vendor DbKeyDump. Bounded to 24,000 characters."""
    return jobs.submit("schema", pid, expected_view, key=key)


@mcp.tool(annotations=COMMAND)
def lt_command(pid: int, expected_view: str, command: str) -> dict:
    """Run a documented LightTools modeling command once. File/exit commands use dedicated tools."""
    return jobs.submit("command", pid, expected_view, command=command)


@mcp.tool(annotations=WRITE)
def lt_ray_trace(pid: int, expected_view: str) -> dict:
    """Run all enabled simulations in a background COM job; poll lt_job_status."""
    return jobs.submit("trace", pid, expected_view)


@mcp.tool(annotations=READ)
def lt_receiver_mesh(pid: int, expected_view: str, key: str = "RECEIVER[1].MESH[1]",
                     cell_filter: str = "CellFlux") -> dict:
    """Read a receiver mesh, return dimensions, statistics and a 5x5 preview."""
    return jobs.submit("mesh", pid, expected_view, key=key, cell_filter=cell_filter, csv_path=None)


@mcp.tool(annotations=WRITE)
def lt_export_mesh_csv(pid: int, expected_view: str, csv_path: str, key: str = "RECEIVER[1].MESH[1]",
                       cell_filter: str = "CellFlux") -> dict:
    """Export mesh data to a new absolute CSV path, preserving the vendor array orientation."""
    return jobs.submit("mesh", pid, expected_view, key=key, cell_filter=cell_filter, csv_path=csv_path)


@mcp.tool(annotations=READ)
def lt_docs_search(query: str, section: str = "api", limit: int = 15) -> dict:
    """Search installed vendor page titles. Sections: api, cmd, dbhlp. Returns filenames."""
    if not 1 <= limit <= 50:
        raise ValueError("limit must be 1 to 50")
    return search_docs(query, section, limit)


@mcp.tool(annotations=READ)
def lt_docs_read(filename: str, section: str = "api", offset: int = 0, max_chars: int = 12000) -> dict:
    """Read text from a vendor page found by lt_docs_search, with bounded pagination."""
    if offset < 0 or not 1 <= max_chars <= 24000:
        raise ValueError("offset >= 0 and max_chars from 1 to 24000 are required")
    doc = read_doc(section, filename)
    full = doc["text"]
    doc["text"] = full[offset:offset + max_chars]
    doc["next_offset"] = offset + max_chars if offset + max_chars < len(full) else None
    return doc


def main():
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
