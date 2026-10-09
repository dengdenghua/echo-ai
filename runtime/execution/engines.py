"""Engine-neutral execution admission and binding.

The host retains task state, permissions, persistence and finalization. This
module binds one execution adapter for the lifetime of a turn and prevents a
continuation from selecting a different engine. It does not plan, retry or
interpret model output.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Generic, Literal, Protocol, TypeVar


class EngineId(StrEnum):
    ECHO = "echo"
    CODEX = "codex"
    OPENCODE = "opencode"


class ExecutionPhase(StrEnum):
    PRIMARY = "primary"
    STEERING = "steering"
    VERIFICATION = "verification"
    REPAIR = "repair"


CredentialScope = Literal["client_identity", "account_token", "host_router"]
"""How an engine's upstream authorizes a call.

``client_identity``  the provider authorizes the *client*, not just the key.
                     OpenCode Zen's free tier answers HTTP 400 ``MissingSessionID``
                     to anything but the official process, so the host must run
                     the vendored binary and cannot wrap it as a model API.
``account_token``    a principal-scoped token authorizes the call, so the native
                     kernel may hold it and dial the endpoint directly.
``host_router``      the host's own configured provider credentials, never handed
                     to a model-controlled process.
"""


@dataclass(frozen=True, slots=True)
class EngineCapabilities:
    """What an engine can actually do, declared instead of discovered at runtime.

    Admission compares these against a turn's :class:`CapabilityRequest` *before*
    any effect. Without this, a turn needing vision or write tools could bind to
    a text-only free path and only fail after the user waited for it.
    """

    tools: bool
    vision: bool
    team_orchestration: bool
    free_tier: bool
    max_tools: int
    credential_scope: CredentialScope

    # ``vision`` is input-side only: can a user-attached image reach the model?
    # It says nothing about images coming *back* through tool results — the
    # screenshot tools already return ``ImageContent`` over the OpenCode MCP
    # (docs/audits/automation-image-return-2026-09-12.md) while the OpenCode
    # turn driver still sends a plain text prompt and drops user attachments.


# Sourced from the shipped behaviour, not aspiration:
#   echo     · native ReAct; retained for offline/self-hosted control. Not offered
#              in the composer picker (frontend hardcodes auto/opencode/codex) and
#              kept only so stored preferences and history badges stay truthful.
#   codex    · App Server protocol over a vendored binary.
#   opencode · vendored official binary with targeted tool denies (bash/edit/
#              write; a wildcard "*" deny would trip Zen's free-tier gate) and
#              host tools arriving over a per-turn MCP. Team orchestration is
#              not wired (see docs/audits/shared-engine-tools-2026-09-08.md).
#              The turn driver sends a text-only prompt, so user-attached
#              images never reach the model — hence vision=False.
#
# max_tools mirrors tool_engine.host_tool_broker._MAX_DYNAMIC_TOOLS, which both
# external engines share — Codex through dynamic_tools and OpenCode through
# host_mcp. shared-engine-tools-2026-09-08.md originally recorded a 64-tool
# budget for OpenCode; no such limit exists in the code, and the doc now carries
# a 2026-09-13 correction. This table and
# ``test_max_tools_matches_the_broker`` are the authority.
_MAX_HOST_TOOLS = 128
"""Mirror of ``tool_engine.host_tool_broker._MAX_DYNAMIC_TOOLS``.

Duplicated as a literal rather than imported: this module is the low-level
admission contract and importing the tool engine here would invert the
dependency direction. ``test_max_tools_matches_the_broker`` keeps the two in
sync so the copy cannot drift silently.
"""

_CAPABILITIES: Mapping[EngineId, EngineCapabilities] = MappingProxyType(
    {
        EngineId.ECHO: EngineCapabilities(
            tools=True,
            vision=True,
            team_orchestration=True,
            free_tier=False,
            max_tools=_MAX_HOST_TOOLS,
            credential_scope="host_router",
        ),
        EngineId.CODEX: EngineCapabilities(
            tools=True,
            vision=True,
            team_orchestration=True,
            free_tier=False,
            max_tools=_MAX_HOST_TOOLS,
            credential_scope="account_token",
        ),
        EngineId.OPENCODE: EngineCapabilities(
            tools=True,
            vision=False,
            team_orchestration=False,
            free_tier=True,
            max_tools=_MAX_HOST_TOOLS,
            credential_scope="client_identity",
        ),
    }
)


def engine_capabilities(engine: EngineId) -> EngineCapabilities:
    return _CAPABILITIES[engine]


@dataclass(frozen=True, slots=True)
class CapabilityRequest:
    """What this turn structurally needs, derived from host-known facts.

    Every field must come from something the host already established — an
    attachment's media type, the resolved write scope, the selected team mode.
    Never from guessing at the prompt text.
    """

    tools: bool = False
    vision: bool = False
    team_orchestration: bool = False

    def unmet_by(self, capabilities: EngineCapabilities) -> tuple[str, ...]:
        return tuple(
            name
            for name in ("tools", "vision", "team_orchestration")
            if getattr(self, name) and not getattr(capabilities, name)
        )


class EngineSelectionError(RuntimeError):
    """A requested backend cannot satisfy this task before execution starts."""

    def __init__(
        self,
        message: str,
        *,
        engine: EngineId,
        reason: str,
        unmet: tuple[str, ...] = (),
        alternatives: tuple[EngineId, ...] = (),
    ) -> None:
        super().__init__(message)
        self.engine = engine
        self.reason = reason
        self.unmet = unmet
        self.alternatives = alternatives


def engines_supporting(request: CapabilityRequest) -> tuple[EngineId, ...]:
    return tuple(engine for engine, caps in _CAPABILITIES.items() if not request.unmet_by(caps))


def verify_engine_admission(engine: EngineId, request: CapabilityRequest) -> None:
    """Reject an impossible binding before the engine performs any effect.

    Raising here keeps a text-only free path from accepting a turn that needs
    vision or write tools and failing only after the user waited for it. This is
    a structural check, not an authorization or readiness check — a satisfied
    request still passes through the engine's own credential and permission
    gates.
    """
    unmet = request.unmet_by(engine_capabilities(engine))
    if not unmet:
        return
    raise EngineSelectionError(
        f"{engine.value} cannot satisfy this task: {', '.join(unmet)}",
        engine=engine,
        reason="capability_unmet",
        unmet=unmet,
        alternatives=engines_supporting(request),
    )


@dataclass(frozen=True, slots=True)
class ExecutionRoute:
    engine: EngineId
    driver: str
    reason: str

    def driver_for(self, phase: ExecutionPhase) -> str:
        # Dispatch-only routes: the remote side owns every phase of the work.
        if self.reason in {"remote_group_member", "work_location_node"}:
            return self.driver
        if phase is ExecutionPhase.PRIMARY and self.driver in {
            "project_os",
            "group_fanout",
            "swarm_mesh",
        }:
            return self.driver
        if self.engine is EngineId.CODEX:
            return "codex_app_server"
        if self.engine is EngineId.OPENCODE:
            return "opencode_server"
        return self.driver if phase is ExecutionPhase.PRIMARY else "react"


def select_execution_route(
    *,
    project_command: bool = False,
    group_fanout: bool = False,
    topology_id: str | None = None,
    codex_partner: bool = False,
    reflection_fast_path: bool = False,
    requested_engine: EngineId | None = None,
    coding_task: bool = False,
    coordinated: bool = False,
    coordinator_engine: EngineId | None = None,
    default_engine: EngineId | None = None,
    required: CapabilityRequest | None = None,
) -> ExecutionRoute:
    """Resolve host-validated signals without an additional model call.

    Project/team orchestration takes precedence over a roster member's engine.
    Individual members retain their own engine binding when dispatched.

    When ``required`` is supplied, the resolved engine is verified against its
    declared capabilities and an impossible binding raises
    :class:`EngineSelectionError` instead of failing mid-turn. Callers that omit
    it keep the previous behaviour unchanged.
    """
    route = _resolve_route(
        project_command=project_command,
        group_fanout=group_fanout,
        topology_id=topology_id,
        codex_partner=codex_partner,
        reflection_fast_path=reflection_fast_path,
        requested_engine=requested_engine,
        coding_task=coding_task,
        coordinated=coordinated,
        coordinator_engine=coordinator_engine,
        default_engine=default_engine,
    )
    if required is not None:
        verify_engine_admission(route.engine, required)
    return route


def _resolve_route(
    *,
    project_command: bool,
    group_fanout: bool,
    topology_id: str | None,
    codex_partner: bool,
    reflection_fast_path: bool,
    requested_engine: EngineId | None,
    coding_task: bool,
    coordinated: bool,
    coordinator_engine: EngineId | None,
    default_engine: EngineId | None,
) -> ExecutionRoute:
    # These schedulers run on the host regardless of the selected model
    # engine. External adapters dispatch them before model continuations.
    orchestration_engine = requested_engine or coordinator_engine or EngineId.ECHO
    if project_command:
        return ExecutionRoute(orchestration_engine, "project_os", "explicit_project")
    if group_fanout:
        return ExecutionRoute(orchestration_engine, "group_fanout", "explicit_group")
    if topology_id:
        return ExecutionRoute(orchestration_engine, "swarm_mesh", "explicit_topology")
    if coordinated:
        selected = requested_engine or coordinator_engine
        if selected is EngineId.OPENCODE:
            return ExecutionRoute(EngineId.OPENCODE, "opencode_server", "team_coordinator")
        if selected is EngineId.CODEX:
            return ExecutionRoute(EngineId.CODEX, "codex_app_server", "team_coordinator")
        return ExecutionRoute(EngineId.ECHO, "react", "team_coordinator")
    if requested_engine is EngineId.CODEX:
        return ExecutionRoute(EngineId.CODEX, "codex_app_server", "explicit_engine")
    if requested_engine is EngineId.OPENCODE:
        return ExecutionRoute(EngineId.OPENCODE, "opencode_server", "explicit_engine")
    if requested_engine is EngineId.ECHO:
        driver = "reflection_fast_path" if reflection_fast_path and not coding_task else "react"
        return ExecutionRoute(EngineId.ECHO, driver, "explicit_engine")
    if codex_partner:
        return ExecutionRoute(EngineId.CODEX, "codex_app_server", "role_backend")
    if default_engine is EngineId.OPENCODE:
        return ExecutionRoute(EngineId.OPENCODE, "opencode_server", "host_default")
    if default_engine is EngineId.CODEX:
        return ExecutionRoute(EngineId.CODEX, "codex_app_server", "host_default")
    if coding_task:
        return ExecutionRoute(EngineId.CODEX, "codex_app_server", "coding_task")
    if reflection_fast_path:
        return ExecutionRoute(EngineId.ECHO, "reflection_fast_path", "reflection")
    return ExecutionRoute(EngineId.ECHO, "react", "native_default")


RequestT = TypeVar("RequestT")
RequestContra = TypeVar("RequestContra", contravariant=True)


class ExecutionAdapter(Protocol[RequestContra]):
    @property
    def engine(self) -> EngineId: ...

    async def execute(self, request: RequestContra, phase: ExecutionPhase) -> None: ...


class ExecutionAdmissionError(RuntimeError):
    """A duplicate, overlapping or failed invocation cannot be resumed implicitly."""


class ExecutionSupervisor(Generic[RequestT]):
    """One bound adapter; the host's cancellation and journal stay authoritative.

    Admission flags describe invocations only, never task completion. Any
    exception propagates to the host and seals this instance: it cannot silently
    retry an engine that may already have performed effects.
    """

    def __init__(
        self,
        route: ExecutionRoute,
        adapter: ExecutionAdapter[RequestT],
        *,
        is_interrupted: Callable[[], bool],
        before_invoke: Callable[[ExecutionPhase, int], Awaitable[None]],
    ) -> None:
        if adapter.engine != route.engine:
            raise ValueError("adapter does not match the selected execution engine")
        self._route = route
        self._adapter = adapter
        self._is_interrupted = is_interrupted
        self._before_invoke = before_invoke
        self._invocations = 0
        self._in_flight = False
        self._sealed = False

    @property
    def route(self) -> ExecutionRoute:
        return self._route

    async def execute(
        self, request: RequestT, *, phase: ExecutionPhase = ExecutionPhase.PRIMARY
    ) -> None:
        if self._sealed or self._in_flight:
            raise ExecutionAdmissionError("execution is sealed or already in flight")
        if (phase is ExecutionPhase.PRIMARY) != (self._invocations == 0):
            raise ExecutionAdmissionError("execute the primary once before any continuation")
        if self._is_interrupted():
            self._sealed = True
            raise asyncio.CancelledError("execution interrupted before admission")
        self._in_flight = True
        self._invocations += 1
        try:
            await self._before_invoke(phase, self._invocations)
            # Persistence/notification may yield while a user presses Stop.
            if self._is_interrupted():
                raise asyncio.CancelledError("execution interrupted before engine start")
            await self._adapter.execute(request, phase)
        except BaseException:
            self._sealed = True
            raise
        finally:
            self._in_flight = False
