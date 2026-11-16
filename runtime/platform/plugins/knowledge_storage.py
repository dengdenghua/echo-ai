"""Private, host-owned knowledge service. Immutable binaries, persistent data."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any

PLUGIN_ID = "knowledge_storage"


def service_command() -> list[str]:
    """Never select the unrelated OS file-browser's echo-storage command."""
    executable = "echo-storage.exe" if os.name == "nt" else "echo-storage"
    # Native Linux OS sessions use an isolated venv shipped beside resources.
    # This is the host's resource root, never a value supplied by a web request.
    resources = os.environ.get("ECHO_RESOURCES_DIR")
    if resources and not getattr(sys, "frozen", False):
        candidate = (
            Path(resources)
            / "knowledge-storage"
            / ("Scripts" if os.name == "nt" else "bin")
            / executable
        )
        if candidate.is_file():
            return [str(candidate)]
    if getattr(sys, "frozen", False):
        candidate = Path(sys.executable).parent.parent / "knowledge-storage" / executable
        if candidate.is_file():
            return [str(candidate)]
        raise RuntimeError("知识库运行组件缺失，请修复安装或升级桌面包")
    repo = Path(__file__).resolve().parents[3]
    source = repo.parent / "echo-storage"
    python = source / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if python.is_file() and (source / "octopus_storage/cli.py").is_file():
        return [str(python), "-m", "octopus_storage.cli"]
    raise RuntimeError("知识库开发运行环境缺失，请安装 echo-storage")


class ManagedStorage:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir.resolve()
        self._process: subprocess.Popen | None = None
        self._lock = threading.RLock()
        self._lease: Any = None
        self._url = ""
        self._token = ""
        self.error: str | None = None

    @property
    def running(self) -> bool:
        return bool(self._process and self._process.poll() is None and self._url)

    def endpoint(self) -> tuple[str, str]:
        if not self.running:
            raise RuntimeError("知识库已停止，请在知识库中启动插件")
        return self._url, self._token

    def request(self, method: str, path: str, payload: dict | None = None) -> Any:
        url, token = self.endpoint()
        req = urllib.request.Request(
            url + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method=method,
        )
        # This private endpoint is always literal loopback HTTP. Building the
        # default opener also initializes HTTPS trust stores (which can be
        # unavailable in frozen hosts), even for an HTTP-only request. Admit
        # only HTTP here, without ambient proxies or credentialed redirects.
        opener = urllib.request.OpenerDirector()
        for handler in (
            urllib.request.HTTPHandler(),
            urllib.request.HTTPDefaultErrorHandler(),
            urllib.request.HTTPErrorProcessor(),
        ):
            opener.add_handler(handler)
        with opener.open(req, timeout=10) as response:
            return json.load(response)

    def _acquire_lease(self) -> None:
        handle = (self.data_dir / ".service.lock").open("a+b")
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise RuntimeError("此知识库数据目录正在由另一个应用使用") from exc
        self._lease = handle

    def start(self) -> None:
        with self._lock:
            if self.running:
                return
            self.stop()
            command = service_command()
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self._acquire_lease()
            record = self.data_dir / "service-runtime.json"
            record.unlink(missing_ok=True)
            # Keep one previous bounded diagnostic log, never a pipe that can fill.
            log = self.data_dir / "service.log"
            if log.exists() and log.stat().st_size > 2 * 1024 * 1024:
                log.replace(self.data_dir / "service.previous.log")
            try:
                instance_id = uuid.uuid4().hex
                with log.open("ab") as output:
                    self._process = subprocess.Popen(
                        [
                            *command,
                            "serve",
                            "--host",
                            "127.0.0.1",
                            "--port",
                            "0",
                            "--db",
                            str(self.data_dir / "storage.sqlite3"),
                            "--connection-file",
                            str(record),
                            "--managed-stdin",
                            "--instance-id",
                            instance_id,
                        ],
                        stdin=subprocess.PIPE,
                        stdout=output,
                        stderr=output,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    )
                deadline = time.monotonic() + 25
                last_probe_error = None
                while time.monotonic() < deadline:
                    if self._process.poll() is not None:
                        raise RuntimeError("知识库启动失败，请查看知识库服务日志")
                    try:
                        data = json.loads(record.read_text(encoding="utf-8"))
                        if data.get("instance_id") != instance_id:
                            raise ValueError("unexpected service owner")
                        port = int(data["port"])
                        if not 0 < port < 65536:
                            raise ValueError("invalid port")
                        self._url = f"http://127.0.0.1:{port}"
                        self._token = (self.data_dir / "api_token").read_text().strip()
                        manifest = self.request("GET", "/v1/manifest")
                        if manifest.get(
                            "service"
                        ) != "echo-storage" or "local.index_jobs" not in manifest.get(
                            "capabilities", []
                        ):
                            raise RuntimeError("知识库组件版本不兼容")
                        self.error = None
                        return
                    except (OSError, ValueError, KeyError) as exc:
                        last_probe_error = exc
                        time.sleep(0.1)
                logging.getLogger(__name__).warning(
                    "Knowledge readiness probe failed: %s: %s",
                    type(last_probe_error).__name__, last_probe_error,
                )
                raise RuntimeError("知识库启动超时，请查看知识库服务日志")
            except Exception as exc:
                self.error = str(exc)
                self.stop()
                raise

    def stop(self) -> None:
        with self._lock:
            process, self._process = self._process, None
            self._url = self._token = ""
            if process:
                if process.stdin:
                    process.stdin.close()  # EOF requests graceful child shutdown.
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=5)
            if self._lease:
                self._lease.close()
                self._lease = None


def managed_service(request: Any) -> ManagedStorage | None:
    """None means a legacy embedder; managed hosts fail closed when disabled."""
    hub = getattr(request.app.state, "plugin_hub", None)
    if hub is None:
        return None
    plugin = hub.get_plugin(PLUGIN_ID)
    if plugin is None or not plugin.active:
        raise RuntimeError("请先安装并启用知识库插件")
    plugin.service.endpoint()
    return plugin.service
