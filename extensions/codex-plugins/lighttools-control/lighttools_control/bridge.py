"""COM calls run on one worker, with a per-PID Windows mutex across MCP processes."""

import csv
import json
import math
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import psutil
import pythoncom
import win32api
import win32com.client
import win32com.client.dynamic
import win32event
import win32gui
import win32process

from .docs import installation


def now():
    return datetime.now(timezone.utc).isoformat()


def processes():
    out = []
    for proc in psutil.process_iter(["pid", "name", "exe", "create_time"]):
        if (proc.info["name"] or "").casefold() == "lt.exe":
            out.append(proc.info)
    return out


def process_identity(pid):
    proc = psutil.Process(pid)
    if proc.name().casefold() != "lt.exe":
        raise ValueError(f"PID {pid} is not LightTools")
    return proc.create_time()


def license_dialog(pid):
    found = []
    def inspect_window(hwnd, _):
        _, owner = win32process.GetWindowThreadProcessId(hwnd)
        if owner == pid and win32gui.GetClassName(hwnd) == "#32770":
            title = win32gui.GetWindowText(hwnd)
            if re.search(r"许可证.*错误|licen[cs]e.*(?:error|fail)", title, re.I):
                found.append(title)
    win32gui.EnumWindows(inspect_window, None)
    return found[0] if found else None


@contextmanager
def session_mutex(pid):
    mutex = win32event.CreateMutex(None, False, rf"Local\Codex.LightToolsControl.{pid}")
    acquired = False
    try:
        outcome = win32event.WaitForSingleObject(mutex, 0)
        if outcome == win32event.WAIT_ABANDONED:
            acquired = True
            raise RuntimeError("A previous controller exited during an operation. Inspect the model before continuing.")
        if outcome != win32event.WAIT_OBJECT_0:
            raise RuntimeError("Another LightTools MCP job is using this PID; no command was executed.")
        acquired = True
        yield
    finally:
        if acquired:
            win32event.ReleaseMutex(mutex)
        win32api.CloseHandle(mutex)


class APIError(RuntimeError):
    def __init__(self, function, status, detail=""):
        self.function, self.status = function, status
        super().__init__(f"{function} returned LightTools status {status}. {detail}".strip())


class Session:
    def __init__(self, pid, created, expected_view=None):
        if process_identity(pid) != created:
            raise RuntimeError("The requested process has exited or its PID has been reused")
        # Do not instantiate LightTools.LTAPI4 here: it can launch an extra session.
        # JSNET's generated pywin32 wrapper contains an invalid default `nan`;
        # use dynamic dispatch for JSNET, and typed dispatch only for LTAPI4.
        self.js = win32com.client.dynamic.Dispatch("LTCOM64.JSNET")
        raw, status = self.js.GetLTAPI4FromPID(pid)
        if status != 0 or raw is None:
            raise APIError("GetLTAPI4FromPID", status)
        self.lt = win32com.client.gencache.EnsureDispatch(raw)
        if self.lt.GetServerID() != pid:
            raise RuntimeError("COM connected to a different PID; no model command was executed")
        self.pid = pid
        if expected_view is not None and self.active_view() != expected_view:
            raise RuntimeError("Active view has changed. Call lt_connect and inspect it before submitting again.")

    def detail(self):
        try:
            return str(self.lt.GetLastMsg(1)[0])
        except Exception:
            return ""

    def value(self, method, *args):
        result = getattr(self.lt, method)(*args)
        if not isinstance(result, tuple) or len(result) != 2:
            raise RuntimeError(f"Unexpected {method} return shape: {type(result).__name__}")
        value, status = result
        if status != 0:
            raise APIError(method, status, self.detail())
        return value

    def status(self, method, *args):
        status = getattr(self.lt, method)(*args)
        if status != 0:
            raise APIError(method, status, self.detail())
        return 0

    def cmd(self, command):
        return self.status("Cmd", command)

    def active_view(self):
        return self.value("GetActiveView")

    def get(self, key, field, i=-1, j=-1):
        return self.value("DbGet", key, field, 0, i, j)

    def info(self):
        return {"pid": self.pid, "version": self.value("Version", 2), "active_view": self.active_view(),
                "licenses": {name: {"available": bool(self.value("LicenseIsAvailable", name)),
                                    "checked_out": bool(self.value("LicenseIsCheckedOut", name))}
                             for name in ("LTCore", "LTLUM", "LTOPT")}}

    def objects(self, root, kind, limit):
        key = self.value("DbList", root, kind)
        try:
            size = int(self.value("ListSize", key))
            out = []
            for _ in range(min(size, limit)):
                item = self.value("ListNext", key)
                out.append({"key": self.value("DbKeyStr", item), "name": self.get(item, "Name")})
            return {"root": root, "filter": kind, "count": size, "objects": out, "truncated": size > limit}
        finally:
            self.status("ListDelete", key)

    def read_object_fields(self, root, kind, fields, limit, compare_paths=False, i=-1, j=-1):
        """Read through list handles before deleting the list; never expose handles."""
        def read_fields(key):
            result = {}
            for field in fields:
                try:
                    value = self.get(key, field, i, j)
                    json.dumps(value, allow_nan=False)  # reject vendor NaN even with status 0
                    result[field] = {"value": value, "api_status": 0}
                except APIError as exc:
                    result[field] = {"api_status": exc.status, "error": str(exc)}
            return result

        listing = self.value("DbList", root, kind)
        try:
            count = int(self.value("ListSize", listing))
            objects = []
            for index in range(min(count, limit)):
                handle = self.value("ListNext", listing)
                path = self.value("DbKeyStr", handle)
                obj = {"index": index + 1, "path": path, "fields": read_fields(handle)}
                if compare_paths:
                    obj["path_fields"] = read_fields(path)
                objects.append(obj)
            return {"root": root, "filter": kind, "count": count, "returned": len(objects),
                    "truncated": count > limit, "objects": objects,
                    "native_reads_within_list_lifetime": True,
                    "interpretation": "Inspect each field's api_status. Paths may be ambiguous; list indices are not stable object identities."}
        finally:
            self.status("ListDelete", listing)

    def read_child_fields(self, root, parent_kind, parent_fields, child_kind, child_fields,
                          parent_limit, child_limit, parent_offset=0):
        """Keep parent and child native lists alive; never re-resolve display paths."""
        def fields(key, names):
            result = {}
            for name in names:
                try:
                    value = self.get(key, name)
                    json.dumps(value, allow_nan=False)
                    result[name] = {"value": value, "api_status": 0}
                except APIError as exc:
                    result[name] = {"api_status": exc.status, "error": str(exc)}
            return result

        parents = self.value("DbList", root, parent_kind)
        try:
            size = int(self.value("ListSize", parents))
            output = []
            for index in range(min(size, parent_offset + parent_limit)):
                parent = self.value("ListNext", parents)
                if index < parent_offset:
                    continue
                item = {"index": index + 1, "path": self.value("DbKeyStr", parent),
                        "fields": fields(parent, parent_fields)}
                children = self.value("DbList", parent, child_kind)
                try:
                    count = int(self.value("ListSize", children))
                    values = []
                    for child_index in range(min(count, child_limit)):
                        child = self.value("ListNext", children)
                        values.append({"index": child_index + 1,
                                       "path": self.value("DbKeyStr", child),
                                       "fields": fields(child, child_fields)})
                    item.update(children=values, child_count=count,
                                child_returned=len(values), child_truncated=count > child_limit)
                finally:
                    self.status("ListDelete", children)
                output.append(item)
            return {"root": root, "parent_filter": parent_kind, "child_filter": child_kind,
                    "count": size, "parent_offset": parent_offset,
                    "returned": len(output), "truncated": size > parent_offset + len(output),
                    "all_parents_returned": parent_offset == 0 and len(output) == size,
                    "objects": output, "native_parent_and_child_lifetimes_preserved": True,
                    "interpretation": "Paths are display/provenance only. Check counts, truncation and every field status; indices are not persistent identities."}
        finally:
            self.status("ListDelete", parents)

    def mesh(self, key, cell_filter, path=None):
        x = int(self.get(key, "X_Dimension"))
        y = int(self.get(key, "Y_Dimension"))
        if x <= 0 or y <= 0 or x * y > 1_000_000:
            raise ValueError(f"Unsupported mesh size {x} x {y}; limit is 1,000,000 cells")
        # LTAPI4 requires x first, y second. The vendor Python example uses a
        # square mesh and reverses these bounds; a rectangular live test catches it.
        data = [[0.0] * y for _ in range(x)]
        status, data, returned_filter = self.lt.GetMeshData(key, data, cell_filter)
        if status != 0:
            raise APIError("GetMeshData", status, self.detail())
        data = [list(row) for row in data]
        flat = [float(v) for row in data for v in row]
        if not all(math.isfinite(v) for v in flat):
            raise RuntimeError("Mesh contains non-finite values")
        result = {"mesh_key": key, "cell_filter": returned_filter, "x_dimension": x, "y_dimension": y,
                  "returned_shape": [len(data), len(data[0]) if data else 0],
                  "axis_order": ["x", "y"],
                  "sum": math.fsum(flat), "minimum": min(flat), "maximum": max(flat),
                  "values_preview": [row[:5] for row in data[:5]]}
        if cell_filter.casefold() == "cellflux":
            result["total_power"] = float(self.get(key, "TotalPower"))
            result["reported_total_flux_error_percent"] = float(self.get(key, "TOTAL FLUX ERROR"))
            result["flux_difference_percent"] = (
                100 * (result["sum"] - result["total_power"]) / result["total_power"]
                if result["total_power"] else None)
            result["interpretation"] = "CellFlux mesh sum and receiver TotalPower are distinct native results; inspect the reported mesh flux error."
        if path:
            target = new_output(path, ".csv")
            with target.open("x", newline="", encoding="utf-8") as stream:
                csv.writer(stream).writerows(data)
            result["csv_path"] = str(target)
            result["csv_axes"] = "Row index is x; column index is y. Native LTAPI4 order, with no transpose or flip."
        return result

    def schema(self, key):
        with tempfile.TemporaryDirectory(prefix="lighttools-schema-") as folder:
            path = Path(folder) / "schema.txt"
            # fileName is an in/out argument: typed dispatch returns
            # (status, fileName), unlike Cmd/DbSet's scalar status.
            response = self.lt.DbKeyDump(key, str(path))
            status = response[0] if isinstance(response, tuple) else response
            if status != 0:
                raise APIError("DbKeyDump", status, self.detail())
            raw = path.read_bytes()
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("mbcs", errors="replace")
            return {"key": key, "text": text[:24000], "truncated": len(text) > 24000}


def new_output(path, suffix):
    target = Path(path)
    if not target.is_absolute():
        raise ValueError("Use an absolute output path")
    target = target.resolve()
    if target.suffix.casefold() != suffix:
        raise ValueError(f"Output must use {suffix}")
    if target.exists():
        raise FileExistsError("Output already exists. Choose a new filename.")
    if suffix == ".lts" and not re.search(r"\.\d+\.lts$", target.name, re.I):
        # Native model filenames include a version component. SaveAs foo.lts
        # writes foo.1.lts, so reserve/check the actual output name up front.
        target = target.with_name(target.stem + ".1.lts")
        if target.exists():
            raise FileExistsError("The native versioned output already exists. Choose a new filename.")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


class Jobs:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lighttools-com")
        self.lock = threading.Lock()
        self.jobs = {}
        self.log = Path(__file__).resolve().parents[1] / "logs" / "jobs.jsonl"

    def update(self, job_id, **values):
        with self.lock:
            self.jobs[job_id].update(values)
            state = dict(self.jobs[job_id])
        self.log.parent.mkdir(parents=True, exist_ok=True)
        with self.log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(state, ensure_ascii=True, allow_nan=False) + "\n")

    def submit(self, operation, pid=None, view=None, **args):
        json.dumps(args, allow_nan=False)  # reject non-finite numeric inputs before COM
        created = process_identity(pid) if pid is not None else None
        with self.lock:
            if sum(j["status"] in ("queued", "running") for j in self.jobs.values()) >= 32:
                raise RuntimeError("Too many pending jobs")
            if len(self.jobs) >= 256:
                expired = next((key for key, j in self.jobs.items() if j["status"] in ("completed", "failed")), None)
                if expired:
                    del self.jobs[expired]
            job_id = str(uuid.uuid4())
            self.jobs[job_id] = {"job_id": job_id, "operation": operation, "pid": pid,
                                 "status": "queued", "created_at": now(), "mutation_started": False,
                                 "expected_view": view}
        self.update(job_id)
        self.executor.submit(self.run, job_id, created, args)
        return self.snapshot(job_id)

    def snapshot(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise ValueError("Unknown job_id for this MCP process; inspect logs if the server restarted")
            return json.loads(json.dumps(self.jobs[job_id], ensure_ascii=True))

    def run(self, job_id, created, args):
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
        session = None
        try:
            job = self.snapshot(job_id)
            self.update(job_id, status="running", started_at=now())
            if job["operation"] == "start":
                result = self.start(job_id, args.get("new_session", False))
            else:
                with session_mutex(job["pid"]):
                    session = Session(job["pid"], created, job["expected_view"])
                    result = self.perform(job_id, session, job["operation"], args)
            # Some vendor calls return NaN with status 0 for invalid array
            # indices. Reject it before committing a non-JSON job result.
            json.dumps(result, allow_nan=False)
            self.update(job_id, status="completed", finished_at=now(), result=result)
        except Exception as exc:
            error = {"type": type(exc).__name__, "message": str(exc)}
            if isinstance(exc, APIError):
                error["api_function"], error["api_status"] = exc.function, exc.status
            self.update(job_id, status="failed", finished_at=now(), error=error,
                        recovery="Inspect the job/model before resubmitting a mutation. No automatic retry was made.")
        finally:
            session = None
            pythoncom.CoUninitialize()

    def start(self, job_id, new_session=False):
        running = processes()
        launched = new_session or not running
        if len(running) > 1 and not new_session:
            raise RuntimeError("Multiple sessions already exist; use lt_connect with the desired PID")
        if running and not new_session:
            pid = running[0]["pid"]
        else:
            info = subprocess.STARTUPINFO()
            info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            info.wShowWindow = 0
            self.update(job_id, mutation_started=True)
            proc = subprocess.Popen([str(installation() / "lt.exe")], startupinfo=info)
            pid = proc.pid
        self.update(job_id, pid=pid, stage="waiting_for_application")
        created = process_identity(pid)
        last_error = None
        for _ in range(60):  # readiness queries only; the process is launched once
            if launched and proc.poll() is not None:
                raise RuntimeError(f"LightTools exited during startup (code {proc.returncode}). Check license environment forwarding and the vendor log.")
            blocked = license_dialog(pid) if launched else None
            if blocked:
                raise RuntimeError(f"LightTools startup was rejected by its license manager ({blocked}). Use an already-running licensed session or resolve the vendor license issue. The original session was not changed.")
            try:
                with session_mutex(pid):
                    session = Session(pid, created)
                    result = session.info()
                    if launched:
                        # Version/console can respond before the startup model
                        # is ready. Wait for its database rather than creating
                        # another default model or another COM server instance.
                        result["model_units"] = session.get("LENS_MANAGER[1]", "UNITS")
                    return result
            except Exception as exc:
                last_error = exc
                time.sleep(1)
        raise RuntimeError(f"LightTools did not become ready in 60 seconds: {last_error}")

    def perform(self, job_id, session, operation, args):
        if operation == "connect":
            return session.info()
        if operation == "get":
            return {"key": args["key"], "field": args["field"],
                    "value": session.get(args["key"], args["field"], args["i"], args["j"]), "api_status": 0}
        if operation == "objects":
            return session.objects(args["root"], args["kind"], args["limit"])
        if operation == "read_object_fields":
            return session.read_object_fields(args["root"], args["kind"], args["fields"],
                                              args["limit"], args["compare_paths"], args["i"], args["j"])
        if operation == "read_child_fields":
            return session.read_child_fields(args["root"], args["parent_kind"], args["parent_fields"],
                                             args["child_kind"], args["child_fields"],
                                             args["parent_limit"], args["child_limit"], args.get("parent_offset", 0))
        if operation == "schema":
            return session.schema(args["key"])
        if operation == "mesh":
            if args["csv_path"]:
                self.update(job_id, mutation_started=True)
            return session.mesh(args["key"], args["cell_filter"], args["csv_path"])
        if operation == "set":
            self.update(job_id, mutation_started=True)
            session.status("DbSet", args["key"], args["field"], args["value"], args["i"], args["j"])
            return {"key": args["key"], "field": args["field"],
                    "value": session.get(args["key"], args["field"], args["i"], args["j"]), "api_status": 0}
        if operation == "new":
            backup = self.backup_model(job_id, session)
            self.update(job_id, mutation_started=True)
            session.cmd(r"\VConsole New3DDesign \V3D")
            return {**session.info(), "previous_model_backup": backup}
        if operation == "open":
            path = Path(args["path"])
            if not path.is_absolute() or path.suffix.casefold() != ".lts" or not path.is_file():
                raise ValueError("Provide an existing absolute .lts path")
            backup = self.backup_model(job_id, session)
            self.update(job_id, mutation_started=True)
            session.cmd(r"\VConsole")
            with file_dialogs_off(session):
                session.cmd("Open " + session.lt.Str(str(path.resolve())))
            return {**session.info(), "previous_model_backup": backup}
        if operation == "save":
            target = new_output(args["path"], ".lts")
            self.update(job_id, mutation_started=True)
            with file_dialogs_off(session):
                session.cmd("SaveAs " + session.lt.Str(str(target)))
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError("SaveAs returned success but no non-empty file was found")
            return {"path": str(target), "requested_path": args["path"], "size_bytes": target.stat().st_size,
                    "active_view": session.active_view(), "api_status": 0}
        if operation == "command":
            command = args["command"]
            if not command.strip() or len(command) > 16000:
                raise ValueError("Command must contain 1 to 16000 characters")
            if re.search(r"\b(?:Save(?:As)?|Open|New[23]DDesign|Close(?:All)?|Exit|Quit|Shell|System)\b", command, re.I):
                raise ValueError("Use lt_save_copy / lt_open_model for file operations. Session termination is not exposed.")
            self.update(job_id, mutation_started=True)
            session.cmd(command)
            return {"api_status": 0, "active_view": session.active_view()}
        if operation == "trace":
            sources = session.objects("LENS_MANAGER[1]", "SOURCE", 1)["count"]
            receivers = session.objects("LENS_MANAGER[1]", "RECEIVER", 1)["count"]
            if not sources or not receivers:
                raise ValueError("A trace requires at least one source and one receiver")
            self.update(job_id, mutation_started=True, stage="ray_trace")
            session.cmd("BeginAllSimulations")
            return {"api_status": 0, "command": "BeginAllSimulations",
                    "next_step": "Read the receiver mesh to verify the simulation result."}
        raise ValueError(f"Unknown operation: {operation}")

    def backup_model(self, job_id, session):
        # Vendor Open/New3DDesign close the current system. Preserve its complete
        # current state before either command; a failed SaveAs stops replacement.
        folder = Path(__file__).resolve().parents[1] / "recovery"
        target = new_output(str(folder / f"before-replace-{uuid.uuid4()}.lts"), ".lts")
        self.update(job_id, mutation_started=True, stage="saving_previous_model", recovery_path=str(target))
        with file_dialogs_off(session):
            session.cmd("SaveAs " + session.lt.Str(str(target)))
        if not target.is_file() or not target.stat().st_size:
            raise RuntimeError("Previous model could not be backed up; replacement was not executed")
        self.update(job_id, stage="replacing_model")
        return str(target)


@contextmanager
def file_dialogs_off(session):
    saved = session.value("GetOption", "SHOWFILEDIALOGBOX")
    session.status("SetOption", "SHOWFILEDIALOGBOX", 0)
    try:
        yield
    finally:
        session.status("SetOption", "SHOWFILEDIALOGBOX", saved)
