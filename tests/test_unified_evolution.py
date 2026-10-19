"""One implementation owner and one host lifecycle for self-evolution."""

from __future__ import annotations

import ast
import importlib
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from runtime.safety.evolution import auto_trigger, experiment_scheduler, learning_scheduler
from runtime.safety.evolution.service import EvolutionService

ROOT = Path(__file__).resolve().parents[1]


class Worker:
    def __init__(self, *, fail_start: bool = False, fail_stop: bool = False) -> None:
        self.starts: list[tuple[tuple, dict]] = []
        self.stops: list[float] = []
        self.registries: list[object] = []
        self.fail_start, self.fail_stop = fail_start, fail_stop

    def start(self, *args, **kwargs) -> None:
        self.starts.append((args, kwargs))
        if self.fail_start:
            raise RuntimeError("partially started")

    def stop(self, timeout=5.0) -> None:
        self.stops.append(timeout)
        if self.fail_stop:
            raise RuntimeError("stop failed")

    def bind_agent_registry(self, registry) -> None:
        self.registries.append(registry)


@pytest.fixture
def workers(monkeypatch):
    from runtime.safety.evolution import service

    instances = [Worker(), Worker(), Worker()]
    monkeypatch.setattr(learning_scheduler, "get_scheduler", lambda: instances[0])
    monkeypatch.setattr(experiment_scheduler, "get_camouflage_scheduler", lambda: instances[1])
    monkeypatch.setattr(auto_trigger, "get_auto_trigger", lambda: instances[2])
    monkeypatch.setattr(service.feature_flags, "is_on", lambda _name: True)
    return instances


def test_one_service_wires_models_identity_and_shutdown(workers, monkeypatch):
    from runtime.safety.evolution import deep_evolution, forge_auto_tick

    router_calls = []
    disabled = []
    monkeypatch.setattr(
        deep_evolution, "set_evolve_router", lambda *a, **kw: router_calls.append((a, kw))
    )
    monkeypatch.setattr(forge_auto_tick, "disable", lambda: disabled.append(True))
    service = EvolutionService()
    stack, registry, router = object(), object(), object()
    service.start(stack, agent_registry=registry)
    service.start_models(stack, agent_registry=registry, router=router, default_model="mock/test")
    service.bind_agent_registry(registry)
    assert all(len(worker.starts) == 1 for worker in workers)
    assert workers[0].starts[0][1]["agent_registry"] is registry
    assert workers[2].starts[0][1]["agent_registry"] is registry
    assert router_calls == [((router,), {"default_model": "mock/test"})]
    assert workers[0].registries == workers[2].registries == [registry]
    assert service.status()["workers"] == ["experiments", "learning", "reflection"]
    service.stop(timeout=0.5)
    assert all(worker.stops == [0.5] for worker in workers)
    assert disabled == [True]


def test_partial_start_does_not_skip_other_workers_and_is_reaped(workers):
    workers[0].fail_start = True
    service = EvolutionService()
    service.start(object())
    assert len(workers[1].starts) == 1
    assert "partially started" in service.status()["errors"]["learning"]
    service.stop(timeout=0.1)
    assert workers[0].stops == workers[1].stops == [0.1]


def test_stop_failure_does_not_skip_other_workers(workers):
    workers[0].fail_stop = True
    service = EvolutionService()
    service.start(object())
    service.start_models(object())
    service.stop(timeout=0.1)
    assert all(worker.stops == [0.1] for worker in workers)
    assert "stop failed" in service.status()["errors"]["learning"]


def test_stop_joins_workers_concurrently(workers):
    barrier = threading.Barrier(3)
    service = EvolutionService()
    service.start(object())
    service.start_models(object())
    for worker in workers:
        worker.stop = lambda **_kw: barrier.wait(timeout=2)
    service.stop(timeout=0.1)
    assert service.status()["errors"] == {}


def test_master_switch_disables_start_and_capture(workers, monkeypatch):
    from runtime.safety.evolution import service as service_module
    from runtime.safety.evolution import turn_learning

    monkeypatch.setattr(
        service_module.feature_flags, "is_on", lambda name: name != "evolution.enabled"
    )
    monkeypatch.setattr(
        turn_learning,
        "queue_finished_turn_review",
        lambda *a, **kw: pytest.fail("capture disabled"),
    )
    service = EvolutionService()
    service.start(object())
    service.start_models(object())
    assert all(worker.starts == [] for worker in workers)
    assert service.queue_finished_turn_review(object(), object()) is None


def test_host_registers_one_shutdown_owner(workers):
    from fastapi import FastAPI

    from runtime.platform.ui._app_stack import (
        _start_background_schedulers,
        _start_evolution_auto_trigger,
    )

    app, stack = FastAPI(), object()
    _start_background_schedulers(SimpleNamespace(app=app, stack=stack), agent_registry=None)
    _start_evolution_auto_trigger(app, stack, agent_registry=None)
    assert set(app.state.background_scheduler_stops) == {"self-evolution"}


def test_all_public_exports_resolve_to_one_implementation():
    from runtime.safety import evolution

    for name in evolution.__all__:
        assert getattr(evolution, name) is not None, name
    from runtime.memory import turn_scoring

    assert turn_scoring is importlib.import_module("runtime.safety.evolution.turn_scoring")
    from runtime.execution.suckers import memory_skills
    from runtime.safety.evolution import soul_actions

    assert memory_skills._update_soul is soul_actions._update_soul
    assert memory_skills._revert_soul is soul_actions._revert_soul


def test_retired_packages_cannot_accumulate_new_implementations():
    for path in ["memory/learning", "safety/recovery", "safety/experiments"]:
        assert not list((ROOT / "runtime" / path).glob("*.py"))
    retired = tuple(
        "runtime." + path.replace("/", ".")
        for path in ["memory/learning", "safety/recovery", "safety/experiments"]
    )
    violations = []
    for path in (ROOT / "runtime").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = (
                [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else []
            )
            if any(name == old or name.startswith(old + ".") for name in names for old in retired):
                violations.append(str(path.relative_to(ROOT)))
    assert violations == []
