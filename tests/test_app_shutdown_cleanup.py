"""App shutdown reaps every background unit the app (or ``serve``) started.

The regeneration / camouflage / evolution auto-trigger / ambient-suggestion
schedulers, the agent filesystem watcher and the storage heartbeat used to be
started while the app was built and never stopped, so a finished lifespan left
their threads ticking until the interpreter exited. These tests drive a real
lifespan (TestClient enter + exit, and ``run_serve`` with Uvicorn replaced by
one) and assert that nothing we started outlives it.
"""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from runtime.platform.ui._app_background import stop_on_shutdown
from runtime.sensing.gateway import storage_supervisor as ss

APP_SCHEDULER_THREADS = {
    "regeneration-scheduler",
    "camouflage-scheduler",
    "evolution-auto-trigger",
    "ambient-suggestions-scheduler",
}
ALL_SCHEDULER_FLAGS = (
    "ECHO_FF_REGENERATION_ENABLED",
    "ECHO_FF_CAMOUFLAGE_ENABLED",
    "ECHO_FF_EVOLUTION_AUTO_TRIGGER",
    "ECHO_FF_UI_AMBIENT_SUGGESTIONS",
)


def _alive_named(names: set[str]) -> set[str]:
    return {t.name for t in threading.enumerate() if t.name in names and t.is_alive()}


def _leftover_threads(before: set[threading.Thread], *, grace_s: float = 5.0) -> list[str]:
    """Threads started since ``before`` that are still alive after a short grace.

    The grace only covers threads that are already on their way out (the
    TestClient portal thread finishing its event loop); a scheduler blocked on
    its interval wait would still be alive afterwards.
    """
    deadline = time.monotonic() + grace_s
    while True:
        leftover = [t for t in threading.enumerate() if t not in before and t.is_alive()]
        if not leftover or time.monotonic() >= deadline:
            return sorted(f"{t.name} (daemon={t.daemon})" for t in leftover)
        time.sleep(0.05)


def _record_lifespan_tasks(app: FastAPI) -> dict[str, list[str]]:
    """Report asyncio tasks created during the lifespan that survive shutdown.

    The snapshot runs before every other startup hook and the check after
    every other shutdown hook, so anything the app spawned and forgot is
    reported. The TestClient drives shutdown through a fresh anyio portal
    call; those harness tasks are not the app's and are excluded by name.
    """
    seen: dict[str, Any] = {}
    report: dict[str, list[str]] = {"pending": []}

    async def _snapshot() -> None:
        seen["before"] = set(asyncio.all_tasks())

    async def _check() -> None:
        current = asyncio.current_task()
        report["pending"] = sorted(
            f"{task.get_name()}: {task.get_coro()!r}"
            for task in asyncio.all_tasks()
            if task is not current
            and not task.done()
            and task not in seen["before"]
            and not task.get_name().startswith("anyio.from_thread.")
        )

    app.router.on_startup.insert(0, _snapshot)
    app.router.add_event_handler("shutdown", _check)
    return report


class _FakeObserver(threading.Thread):
    """Stands in for watchdog's Observer (optional dependency)."""

    def __init__(self) -> None:
        super().__init__(name="agent-watcher", daemon=True)
        self._stop_requested = threading.Event()

    def run(self) -> None:
        self._stop_requested.wait(60)

    def stop(self) -> None:
        self._stop_requested.set()


# ── stop_on_shutdown helper ─────────────────────────────────────────────


def test_stop_on_shutdown_stops_concurrently_and_isolates_failures() -> None:
    app = FastAPI()
    calls: list[tuple[str, float]] = []
    # Both waiters must be inside their stop at the same time: a sequential
    # shutdown would break the barrier and turn this into a failure.
    together = threading.Barrier(2, timeout=5)
    later_handler_ran = threading.Event()

    def waiting_stop(name: str):
        def _stop(*, timeout: float) -> None:
            calls.append((name, timeout))
            together.wait()

        return _stop

    def broken_stop(*, timeout: float) -> None:
        calls.append(("broken", timeout))
        raise RuntimeError("stuck scheduler")

    stop_on_shutdown(app, "first", lambda **_: pytest.fail("replaced registration ran"))
    stop_on_shutdown(app, "first", waiting_stop("first"), timeout=1.5)
    stop_on_shutdown(app, "broken", broken_stop)
    stop_on_shutdown(app, "second", waiting_stop("second"))
    app.router.add_event_handler("shutdown", later_handler_ran.set)

    # One shared handler for all registrations, plus the later one.
    assert len(app.router.on_shutdown) == 2
    with TestClient(app):
        assert calls == []

    assert sorted(calls) == [("broken", 5.0), ("first", 1.5), ("second", 5.0)]
    assert not together.broken
    assert later_handler_ran.is_set()


# ── create_app lifespan ──────────────────────────────────────────────────


@pytest.fixture
def llm_stack():
    from runtime.memory.journal import InMemoryJournal
    from runtime.sensing.model_router import MockModelRouter

    journal = InMemoryJournal()
    return SimpleNamespace(
        journal=journal,
        executor=SimpleNamespace(journal=journal, registry=None),
        runtime=SimpleNamespace(journal=journal),
        planner=SimpleNamespace(
            router=MockModelRouter(response_fn=lambda _request: "ok"),
            planner_model=None,
        ),
        config=SimpleNamespace(
            mcp_servers=None,
            execution=SimpleNamespace(background_model_calls=True),
        ),
        is_llm_planner=True,
    )


def test_create_app_lifespan_exit_stops_every_scheduler_and_watcher(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    llm_stack,
) -> None:
    from runtime.execution.agents import AgentRegistry
    from runtime.platform.ui.app import create_app
    from runtime.safety.experiments.scheduler import CamouflageScheduler

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ECHO_HOME", str(tmp_path / "home"))
    for flag in ALL_SCHEDULER_FLAGS:
        monkeypatch.setenv(flag, "1")
    # The prompt optimizer needs a real LLMPlanner; the thread lifecycle under
    # test does not, so skip only the component build.
    monkeypatch.setattr(CamouflageScheduler, "_build_components", lambda self, router: None)
    observers: list[_FakeObserver] = []

    def fake_watcher(**_kwargs) -> _FakeObserver:
        observer = _FakeObserver()
        observer.start()
        observers.append(observer)
        return observer

    monkeypatch.setattr("runtime.execution.agents.watcher.start_agent_watcher", fake_watcher)

    before = set(threading.enumerate())
    app = create_app(stack=llm_stack, agent_registry=AgentRegistry(), tentacle_enabled=False)
    tasks = _record_lifespan_tasks(app)
    # The watcher belongs to the lifespan: building the app alone starts nothing.
    assert observers == []

    with TestClient(app):
        assert _alive_named(APP_SCHEDULER_THREADS) == APP_SCHEDULER_THREADS
        assert len(observers) == 1 and observers[0].is_alive()

    assert _alive_named(APP_SCHEDULER_THREADS | {"agent-watcher"}) == set()
    assert app.state.agent_watcher is None
    assert tasks["pending"] == []
    assert _leftover_threads(before) == []


# ── run_serve lifespan ───────────────────────────────────────────────────


def _serve_config(tmp_path: Path) -> Path:
    path = tmp_path / "serve.yaml"
    path.write_text(
        "\n".join(
            [
                "name: shutdown-probe",
                "planner:",
                "  type: llm",
                "  model: mock/serve",
                "  mock_response: '{\"nodes\":[]}'",
                "budget:",
                "  max_tokens: 5000",
                "  max_usd: 0.05",
                # Keep the fixed LAN WebSocket port free during the suite.
                "tentacle:",
                "  enabled: false",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return path


@pytest.mark.usefixtures("bypass_serve_port_guard")
def test_serve_shutdown_leaves_no_background_threads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import uvicorn

    from runtime.cli import run_serve

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ECHO_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("ECHO_FF_REGENERATION_ENABLED", "1")
    monkeypatch.setenv("ECHO_FF_UI_AMBIENT_SUGGESTIONS", "1")
    # Opt into the storage co-launch, with no sibling to find or probe.
    monkeypatch.setenv("ECHO_STORAGE_AUTOSTART", "1")
    monkeypatch.setattr(ss, "_already_up", lambda: False)
    monkeypatch.setattr(ss, "resolve_storage_command", lambda: None)
    monkeypatch.setattr(ss, "_HEARTBEAT_INTERVAL_S", 0.05)
    monkeypatch.setattr(ss, "_heartbeat_started", False)
    monkeypatch.setattr(ss, "_heartbeat_thread", None)
    monkeypatch.setattr(ss, "_heartbeat_stop", None)
    monkeypatch.setattr(ss, "_proc", None)

    lifespan: dict[str, object] = {}

    def fake_uvicorn_run(app, **_kwargs) -> None:
        lifespan["tasks"] = _record_lifespan_tasks(app)
        with TestClient(app):
            lifespan["alive"] = _alive_named(
                {"regeneration-scheduler", "ambient-suggestions-scheduler", "storage-heartbeat"}
            )

    monkeypatch.setattr(uvicorn, "run", fake_uvicorn_run)
    before = set(threading.enumerate())

    rc = run_serve(
        config_path=_serve_config(tmp_path),
        host="127.0.0.1",
        port=9399,
        learn_interval_s=0,
        color=False,
    )

    assert rc == 0
    assert lifespan["alive"] == {
        "regeneration-scheduler",
        "ambient-suggestions-scheduler",
        "storage-heartbeat",
    }
    assert lifespan["tasks"]["pending"] == []
    assert ss.storage_status()["heartbeat"] is False
    assert _leftover_threads(before) == []


# ── storage heartbeat stop ───────────────────────────────────────────────


def test_storage_heartbeat_stop_is_idempotent_and_restartable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ECHO_STORAGE_AUTOSTART", "1")
    monkeypatch.setattr(ss, "_already_up", lambda: True)
    monkeypatch.setattr(ss, "_HEARTBEAT_INTERVAL_S", 0.01)
    monkeypatch.setattr(ss, "_heartbeat_started", False)
    monkeypatch.setattr(ss, "_heartbeat_thread", None)
    monkeypatch.setattr(ss, "_heartbeat_stop", None)
    monkeypatch.setattr(ss, "_proc", None)

    for _generation in range(2):
        ss.start_storage_heartbeat()
        thread = ss._heartbeat_thread
        assert thread is not None and thread.is_alive()
        assert ss.storage_status()["heartbeat"] is True

        ss.shutdown_storage()
        assert not thread.is_alive()
        assert ss.storage_status()["heartbeat"] is False
        ss.stop_storage_heartbeat()  # idempotent
