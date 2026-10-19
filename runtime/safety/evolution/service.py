"""One host-owned lifecycle for the self-evolution subsystem.

The service owns startup, model wiring, agent identity and shutdown. Internal
workers keep their existing intervals, stores and validation gates; hosts do
not start independent learning/evolution subsystems anymore.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from runtime.platform import feature_flags
from runtime.platform.process.paths import app_paths

_LOG = logging.getLogger(__name__)


def learning_config() -> Any:
    from .learning_scheduler import SchedulerConfig

    return SchedulerConfig(
        interval_sec=max(60, int(feature_flags.value("regeneration.interval_sec", 600))),
        initial_delay_sec=30,
        output_dir=str(app_paths().data_dir),
        enabled=feature_flags.is_on("regeneration.enabled"),
    )


class EvolutionService:
    """Coordinate existing algorithms without duplicating their durable state."""

    _instance: EvolutionService | None = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._workers: dict[str, Any] = {}
        self._errors: dict[str, str] = {}

    @classmethod
    def get(cls) -> EvolutionService:
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset(cls) -> None:
        with cls._instance_lock:
            instance, cls._instance = cls._instance, None
        if instance is not None:
            instance.stop(timeout=2.0)

    def _start_worker(self, name: str, worker: Any, *args: Any, **kwargs: Any) -> None:
        # Register before start: partially started workers must also be stopped.
        self._workers[name] = worker
        try:
            worker.start(*args, **kwargs)
            self._errors.pop(name, None)
        except Exception as exc:  # noqa: BLE001 — isolate optional evolution workers
            self._errors[name] = f"{type(exc).__name__}: {exc}"
            _LOG.warning("self-evolution %s start failed: %s", name, exc)

    def start(self, stack: Any, *, agent_registry: Any = None) -> None:
        from .experiment_scheduler import CamouflageConfig, get_camouflage_scheduler
        from .learning_scheduler import get_scheduler

        with self._lock:
            if not feature_flags.is_on("evolution.enabled"):
                self.stop()
                return
            self._start_worker(
                "learning",
                get_scheduler(),
                stack,
                config=learning_config(),
                agent_registry=agent_registry,
            )
            self._start_worker(
                "experiments",
                get_camouflage_scheduler(),
                stack,
                config=CamouflageConfig(
                    enabled=feature_flags.is_on("camouflage.enabled"),
                    interval_sec=max(60, int(feature_flags.value("camouflage.interval_sec", 600))),
                    initial_delay_sec=60,
                ),
            )

    def start_models(
        self,
        stack: Any,
        *,
        agent_registry: Any = None,
        router: Any = None,
        default_model: str | None = None,
    ) -> None:
        from .auto_trigger import AutoTriggerConfig, get_auto_trigger
        from .deep_evolution import set_evolve_router

        with self._lock:
            if not feature_flags.is_on("evolution.enabled"):
                self.stop()
                return
            if router is not None:
                set_evolve_router(router, default_model=default_model)
            self._start_worker(
                "reflection",
                get_auto_trigger(),
                stack,
                AutoTriggerConfig(enabled=feature_flags.is_on("evolution.auto_trigger")),
                agent_registry=agent_registry,
            )

    def bind_agent_registry(self, registry: Any) -> None:
        from .auto_trigger import get_auto_trigger
        from .learning_scheduler import get_scheduler

        with self._lock:
            get_scheduler().bind_agent_registry(registry)
            get_auto_trigger().bind_agent_registry(registry)

    def stop(self, timeout: float = 5.0) -> None:
        from . import forge_auto_tick

        with self._lock:
            stops = [(name, worker.stop) for name, worker in self._workers.items()]
            stops.append(("recipes", forge_auto_tick.stop))
        # Parallel joins preserve the host's bounded shutdown deadline.
        with ThreadPoolExecutor(max_workers=len(stops)) as pool:
            futures = {pool.submit(stop, timeout=timeout): name for name, stop in stops}
            for future, name in futures.items():
                try:
                    future.result()
                except Exception as exc:  # noqa: BLE001 — stop all workers even when one fails
                    with self._lock:
                        self._errors[name] = f"{type(exc).__name__}: {exc}"
                    _LOG.warning("self-evolution %s stop failed: %s", name, exc)

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "module": "runtime.safety.evolution",
                "enabled": feature_flags.is_on("evolution.enabled"),
                "workers": sorted(self._workers),
                "errors": dict(self._errors),
            }

    def queue_finished_turn_review(self, *args: Any, **kwargs: Any) -> dict[str, Any] | None:
        from .turn_learning import queue_finished_turn_review

        if not feature_flags.is_on("evolution.enabled"):
            return None
        return queue_finished_turn_review(*args, **kwargs)


def get_evolution_service() -> EvolutionService:
    return EvolutionService.get()
