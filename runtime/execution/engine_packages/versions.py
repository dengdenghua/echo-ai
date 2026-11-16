"""Immutable engine releases and cross-process task leases.

The small state lock serializes admission and activation. Task locks live for
the entire call, including cancellation cleanup; the OS releases them on a
crash. No PID guessing, heartbeat expiry or replacement of running binaries.
"""
from __future__ import annotations

import asyncio
import contextlib
import contextvars
import functools
import hashlib
import inspect
import json
import os
import re
import time
import uuid
from pathlib import Path

IDS = frozenset({"codex", "opencode", "codebuddy"})
_scope = contextvars.ContextVar("engine_task_scope", default=None)


def _base(root: Path, engine: str) -> Path:
    if engine not in IDS:
        raise ValueError("unknown engine")
    return root / ".versions" / engine


def _lock(handle, blocking=True):
    if os.name == "nt":
        import msvcrt
        deadline = time.monotonic() + (10 if blocking else 0)
        while True:
            try:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.01)
    else:
        import fcntl
        fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))


@contextlib.contextmanager
def locked(root: Path, engine: str):
    base = _base(root, engine)
    base.mkdir(parents=True, exist_ok=True)
    with (base / "state.lock").open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        _lock(handle)
        yield base


def _read(base):
    try:
        value = json.loads((base / "state.json").read_text("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid engine state")
        for key in ("active", "previous", "pending"):
            if value.get(key) and value[key] != "legacy" and not re.fullmatch(r"[a-f0-9]{32}", value[key]):
                raise ValueError("invalid release pointer")
        return value
    except FileNotFoundError:
        return {}


def _replace_with_retry(source, target, *, timeout=5.0):
    """Keep atomic renames, tolerating short Windows executable/file leases.

    A completed --version process can leave its image briefly held by Windows.
    Never fall back to copying, alter permissions, or retry unrelated failures.
    """
    deadline = time.monotonic() + timeout
    delay = .05
    while True:
        try:
            os.replace(source, target)
            return
        except OSError as exc:
            remaining = deadline - time.monotonic()
            if getattr(exc, "winerror", None) not in {5, 32, 33} or remaining <= 0:
                raise
            time.sleep(min(delay, remaining))
            delay = min(delay * 2, .25)


def _write(base, state):
    temporary = base / (uuid.uuid4().hex + ".json")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(temporary, base / "state.json")
    finally:
        temporary.unlink(missing_ok=True)


def _busy(base):
    count = 0
    for path in base.glob("task-*.lock"):
        try:
            with path.open("r+b") as handle:
                _lock(handle, False)
        except FileNotFoundError:
            continue
        except OSError:
            count += 1
            continue
        path.unlink(missing_ok=True)
    return count


def _folder(base, token):
    return base.parent.parent / base.name if token == "legacy" else base / token


def _settle(base, state):
    if state.get("pending") and not _busy(base):
        from .store import read_release
        if read_release(_folder(base, state["pending"]), base.name) is None:
            raise ValueError("pending engine release is damaged")
        state["previous"] = state.get("active") or ("legacy" if read_release(_folder(base, "legacy"), base.name) else None)
        state["active"] = state.pop("pending")
        state["revision"] = int(state.get("revision", 0)) + 1
        _write(base, state)
    return state


def snapshot(root, engine):
    with locked(root, engine) as base:
        state = _settle(base, _read(base))
        return {**state, "active_tasks": _busy(base)}


def release_folder(root, engine):
    state = snapshot(root, engine)
    return _folder(_base(root, engine), state["active"]) if state.get("active") else root / engine


def publish(root, engine, staged):
    """Publish validated bytes; activation waits for all admitted tasks."""
    from .store import read_release
    if read_release(staged, engine) is None:
        raise ValueError("invalid engine release")
    validate_files(staged)
    with locked(root, engine) as base:
        state = _read(base)
        if state.get("pending"):
            raise RuntimeError("a release is already waiting for tasks")
        token = uuid.uuid4().hex
        _replace_with_retry(staged, base / token)
        state["pending"] = token
        _write(base, state)
        return _settle(base, state)


def rollback(root, engine):
    from .store import read_release
    with locked(root, engine) as base:
        state = _read(base)
        previous = state.get("previous")
        if state.get("pending"):
            raise RuntimeError("a release is already waiting for tasks")
        if not previous or read_release(_folder(base, previous), engine) is None:
            raise ValueError("no intact previous release")
        folder = _folder(base, previous)
    # Large dependency inventories must not block task admission or status reads.
    validate_files(folder)
    with locked(root, engine) as base:
        state = _read(base)
        if state.get("pending") or state.get("previous") != previous:
            raise RuntimeError("release state changed while validating rollback")
        state["pending"] = previous
        _write(base, state)
        return _settle(base, state)


def validate_files(folder):
    manifest = json.loads((folder / "echo-engine.json").read_text("utf-8"))
    for relative, record in manifest["files"].items():
        path = folder / relative
        if not path.resolve().is_relative_to(folder.resolve()) or not path.is_file():
            raise ValueError("release file missing or outside release")
        if path.stat().st_size != record["size"]:
            raise ValueError("release file size mismatch")
        if record.get("sha256"):
            with path.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != record["sha256"]:
                    raise ValueError("release file hash mismatch")


@contextlib.contextmanager
def _task_lease(engine, root=None):
    from .store import engines_root
    root = root if root is not None else engines_root()
    with locked(root, engine) as base:
        _settle(base, _read(base))
        path = base / ("task-" + uuid.uuid4().hex + ".lock")
        handle = path.open("x+b")
        handle.write(b"0")
        handle.flush()
        _lock(handle)
    try:
        yield
    finally:
        with locked(root, engine) as base:
            handle.close()
            path.unlink(missing_ok=True)
            _settle(base, _read(base))


@contextlib.contextmanager
def task_lease(engine, root=None):
    from .store import engines_root
    root = root if root is not None else engines_root()
    scope = _scope.get()
    key = (str(root.resolve()), engine)
    if scope is not None and scope[3]["alive"] and key not in scope[1]:
        scope[0].enter_context(_task_lease(engine, root))
        scope[1].add(key)
    try:
        owner = asyncio.current_task()
    except RuntimeError:
        owner = None
    if scope is not None and scope[3]["alive"] and owner is scope[2]:
        yield
        return
    with _task_lease(engine, root):
        yield


def task_scope(function):
    """Pin engines across all phases of a host task, not just one model call."""
    @functools.wraps(function)
    async def call(*args, **kwargs):
        with contextlib.ExitStack() as stack:
            alive = {"alive": True}
            token = _scope.set((stack, set(), asyncio.current_task(), alive))
            try:
                return await function(*args, **kwargs)
            finally:
                alive["alive"] = False
                _scope.reset(token)
    return call


def leased(engine):
    """Keep leases through generator close, subprocess cleanup and errors."""
    def decorate(function):
        if inspect.isasyncgenfunction(function):
            @functools.wraps(function)
            async def stream(*args, **kwargs):
                with task_lease(engine):
                    async with contextlib.aclosing(function(*args, **kwargs)) as events:
                        async for event in events:
                            yield event
            return stream
        @functools.wraps(function)
        async def call(*args, **kwargs):
            with task_lease(engine):
                return await function(*args, **kwargs)
        return call
    return decorate
