"""Minimal JSON-RPC-over-stdio LSP client, its errors, and file-URI helpers for lsp_skills."""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import threading
import urllib.parse
from pathlib import Path
from typing import Any

_LANGUAGE_TO_LSP_LANG_ID: dict[str, str] = {
    "python": "python",
    "typescript": "typescript",
    "javascript": "javascript",
    "rust": "rust",
    "go": "go",
}


# ───────────────────────────── URI helpers ──────────────────────────────────


def _path_to_uri(path: str) -> str:
    p = Path(path).resolve()
    posix = p.as_posix()
    # On Windows, as_posix() yields ``C:/foo/bar``; LSP wants ``file:///C:/foo/bar``.
    if os.name == "nt" and len(posix) >= 2 and posix[1] == ":":
        return "file:///" + urllib.parse.quote(posix, safe="/:")
    return "file://" + urllib.parse.quote(posix, safe="/")


def _uri_to_path(uri: str) -> str:
    if not uri.startswith("file://"):
        return uri
    parsed = urllib.parse.urlparse(uri)
    raw = urllib.parse.unquote(parsed.path)
    if os.name == "nt" and raw.startswith("/") and len(raw) >= 3 and raw[2] == ":":
        raw = raw[1:]
    return str(Path(raw))


# ───────────────────────────── _LSPClient ───────────────────────────────────


class _LSPClient:
    """Minimal JSON-RPC client over a language server's stdio.

    One instance per (language, workspace_root). Spawns a subprocess on
    ``start()``, reads frames on a worker thread, dispatches responses
    via ``threading.Event`` keyed by request id.
    """

    INIT_TIMEOUT = 8.0
    REQUEST_TIMEOUT = 5.0
    _STDERR_TAIL_LINES = 20
    # Sentinel parked in ``_pending`` when the transport dies, so a woken
    # waiter can tell "the server is gone" from "the server said nothing".
    _TRANSPORT_CLOSED: dict[str, Any] = {"__transport_closed__": True}

    def __init__(self, language: str) -> None:
        self.language = language
        self._transport_closed = False
        self._proc: subprocess.Popen[bytes] | None = None
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._pending: dict[int, dict[str, Any]] = {}
        self._events: dict[int, threading.Event] = {}
        self._opened: set[str] = set()  # uris for which didOpen has been sent
        self._reader: threading.Thread | None = None
        self._stderr_reader: threading.Thread | None = None
        self._stderr_tail: list[str] = []
        self._stderr_lock = threading.Lock()
        self._stopped = threading.Event()
        self._capabilities: dict[str, Any] = {}

    # ── lifecycle ─────────────────────────────────────────────────────────

    def start(self, server_argv: list[str], workspace_root: str) -> None:
        spawn_argv = list(server_argv)
        spawn_env = None
        spawn_cwd = None
        from runtime.safety.sandboxing.sandbox import (
            SandboxPolicy,
            SandboxViolation,
            effective_process_sandbox_mode,
            inference_domains,
            process_sandbox_required,
            resolved_process_backend,
        )

        if process_sandbox_required():
            workspace = Path(workspace_root).expanduser().resolve()
            if not workspace.is_dir():
                raise _LSPTransportError(f"sandbox workspace is not a directory: {workspace}")
            policy = SandboxPolicy(
                workspace=workspace,
                allow_network=False,
                timeout_s=self.INIT_TIMEOUT,
                # Model inference endpoints stay reachable in a
                # network-denied sandbox (Claude Desktop parity).
                inference_domains=inference_domains(),
            )
            try:
                choice = resolved_process_backend(effective_process_sandbox_mode())
                spawn_argv, spawn_env, transformed_cwd = choice.backend.transform(
                    spawn_argv,
                    policy.env_for(),
                    workspace,
                    policy,
                )
                spawn_cwd = str(transformed_cwd)
            except SandboxViolation as exc:
                raise _LSPTransportError(f"sandbox_violation: {exc}") from exc
        try:
            self._proc = subprocess.Popen(  # noqa: S603 — argv constructed from constants + workspace path
                spawn_argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
                cwd=spawn_cwd,
                env=spawn_env,
            )
        except (FileNotFoundError, PermissionError, OSError) as exc:
            raise _LSPTransportError(f"failed to spawn {spawn_argv[0]!r}: {exc}") from exc

        self._reader = threading.Thread(
            target=self._read_loop,
            name=f"lsp-reader-{self.language}",
            daemon=True,
        )
        self._reader.start()
        # stderr is a pipe, so something must drain it: a verbose server
        # (rust-analyzer logs freely) otherwise fills the buffer and blocks
        # on its own write while we wait forever for a reply on stdout.
        self._stderr_reader = threading.Thread(
            target=self._drain_stderr,
            name=f"lsp-stderr-{self.language}",
            daemon=True,
        )
        self._stderr_reader.start()

        root_uri = _path_to_uri(workspace_root)
        try:
            self.request(
                "initialize",
                {
                    "processId": os.getpid(),
                    "rootUri": root_uri,
                    "rootPath": str(Path(workspace_root).resolve()),
                    "workspaceFolders": [{"uri": root_uri, "name": Path(workspace_root).name}],
                    "capabilities": {
                        "textDocument": {
                            "synchronization": {"dynamicRegistration": False},
                            "definition": {"linkSupport": False},
                            "references": {},
                            "hover": {"contentFormat": ["markdown", "plaintext"]},
                            "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                        },
                    },
                },
                timeout=self.INIT_TIMEOUT,
            )
            self.notify("initialized", {})
        except _LSPError as exc:
            # A binary that exists but refuses to run -- a rustup shim for an
            # uninstalled component, a wrapper missing its runtime -- reports
            # only "server not running" from the reader thread, while the real
            # reason sits in stderr. Attach it, or the caller is told nothing.
            detail = self._startup_detail(exc)
            self.shutdown()
            raise _LSPTransportError(detail) from exc

    def _drain_stderr(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        try:
            for raw in proc.stderr:
                line = raw.decode("utf-8", errors="replace").rstrip()
                if not line:
                    continue
                with self._stderr_lock:
                    self._stderr_tail.append(line)
                    if len(self._stderr_tail) > self._STDERR_TAIL_LINES:
                        del self._stderr_tail[: -self._STDERR_TAIL_LINES]
        except (OSError, ValueError):  # noqa: BLE001 — pipe closed on shutdown
            return

    def stderr_tail(self, limit: int = 3) -> str:
        with self._stderr_lock:
            return " | ".join(self._stderr_tail[-limit:])

    def _startup_detail(self, exc: Exception) -> str:
        parts = [str(exc)]
        proc = self._proc
        if proc is not None:
            with contextlib.suppress(subprocess.TimeoutExpired):
                # Let the stderr pump finish the line, or the message is empty.
                proc.wait(timeout=2.0)
            code = proc.poll()
            if code is not None:
                parts.append(f"exit={code}")
        detail = self.stderr_tail()
        if detail:
            parts.append(f"stderr: {detail}")
        return " · ".join(parts)

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def shutdown(self) -> None:
        self._stopped.set()
        proc = self._proc
        if proc is None:
            return
        try:
            if proc.poll() is None:
                # Best-effort graceful shutdown; ignore failures.
                try:
                    self._send_raw(
                        {"jsonrpc": "2.0", "id": -1, "method": "shutdown", "params": None}
                    )
                    self._send_raw({"jsonrpc": "2.0", "method": "exit"})
                except (OSError, _LSPTransportError):  # noqa: BLE001 — best-effort; a dead pipe raises EINVAL on Windows
                    pass
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
        finally:
            self._proc = None

    # ── JSON-RPC plumbing ─────────────────────────────────────────────────

    def _next_request_id(self) -> int:
        with self._id_lock:
            rid = self._next_id
            self._next_id += 1
            return rid

    def _send_raw(self, msg: dict[str, Any]) -> None:
        if self._proc is None or self._proc.stdin is None:
            raise _LSPTransportError("server stdin closed")
        body = json.dumps(msg).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        with self._send_lock:
            try:
                self._proc.stdin.write(header + body)
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                raise _LSPTransportError(f"send failed: {exc}") from exc

    def request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        if not self.is_alive():
            raise _LSPTransportError(f"server not running for {self.language}")
        rid = self._next_request_id()
        evt = threading.Event()
        self._events[rid] = evt
        self._send_raw({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})

        wait_for = self.REQUEST_TIMEOUT if timeout is None else timeout
        if not evt.wait(wait_for):
            self._events.pop(rid, None)
            self._pending.pop(rid, None)
            raise _LSPTimeoutError(f"{method} timed out after {wait_for}s")

        msg = self._pending.pop(rid, {})
        self._events.pop(rid, None)
        if msg is self._TRANSPORT_CLOSED or (not msg and self._transport_closed):
            raise _LSPTransportError(f"{method} unanswered: server closed the connection")
        if "error" in msg:
            err = msg["error"] or {}
            raise _LSPRequestError(
                f"{method} failed: {err.get('message', 'unknown error')}",
                code=err.get("code"),
            )
        return msg.get("result") or {}

    def notify(self, method: str, params: dict[str, Any]) -> None:
        if not self.is_alive():
            raise _LSPTransportError(f"server not running for {self.language}")
        self._send_raw({"jsonrpc": "2.0", "method": method, "params": params})

    def _read_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        stdout = proc.stdout
        buffer = b""
        while not self._stopped.is_set():
            try:
                chunk = stdout.read(4096)
            except (OSError, ValueError):
                break
            if not chunk:
                break
            buffer += chunk
            while True:
                # Look for header terminator.
                hdr_end = buffer.find(b"\r\n\r\n")
                if hdr_end < 0:
                    break
                header = buffer[:hdr_end].decode("ascii", errors="replace")
                length = 0
                for line in header.split("\r\n"):
                    if line.lower().startswith("content-length:"):
                        try:
                            length = int(line.split(":", 1)[1].strip())
                        except ValueError:
                            length = 0
                if length <= 0:
                    # Bad frame; drop header and keep going.
                    buffer = buffer[hdr_end + 4 :]
                    continue
                total = hdr_end + 4 + length
                if len(buffer) < total:
                    break
                body = buffer[hdr_end + 4 : total]
                buffer = buffer[total:]
                try:
                    msg = json.loads(body.decode("utf-8"))
                except json.JSONDecodeError:
                    continue
                self._dispatch(msg)
        # The stream ended, so no pending request will ever be answered. Wake
        # the waiters with a reason: woken-and-empty is indistinguishable from
        # a legitimate "no result" reply, which turns a dead server into
        # "no definition found" at the call site.
        self._transport_closed = True
        for rid, evt in list(self._events.items()):
            self._pending.setdefault(rid, self._TRANSPORT_CLOSED)
            evt.set()

    def _dispatch(self, msg: dict[str, Any]) -> None:
        rid = msg.get("id")
        if rid is None:
            # server-originated notification / log; ignore.
            return
        if "method" in msg:
            # Server -> client request; we don't honor any of these.
            return
        evt = self._events.get(rid)
        if evt is None:
            return
        self._pending[rid] = msg
        evt.set()

    # ── helpers ───────────────────────────────────────────────────────────

    def ensure_open(self, path: str) -> None:
        """Send didOpen for ``path`` if we haven't already this session."""
        uri = _path_to_uri(path)
        if uri in self._opened:
            return
        try:
            text = Path(path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise _LSPTransportError(f"read_failed: {exc}") from exc
        self.notify(
            "textDocument/didOpen",
            {
                "textDocument": {
                    "uri": uri,
                    "languageId": _LANGUAGE_TO_LSP_LANG_ID.get(self.language, self.language),
                    "version": 1,
                    "text": text,
                }
            },
        )
        self._opened.add(uri)


# ───────────────────────────── exceptions ───────────────────────────────────


class _LSPError(Exception):
    """Base class for LSP client failures."""


class _LSPTransportError(_LSPError):
    """Subprocess / pipe / framing failure."""


class _LSPTimeoutError(_LSPError):
    """A request didn't return within the deadline."""


class _LSPRequestError(_LSPError):
    """The server returned an error response."""

    def __init__(self, msg: str, *, code: int | None = None) -> None:
        super().__init__(msg)
        self.code = code


class _DependencyMissing(_LSPError):
    """No candidate server executable on PATH."""
