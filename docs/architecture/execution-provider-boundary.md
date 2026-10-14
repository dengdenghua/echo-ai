# Execution Provider Boundary

Echo owns the durable control plane: conversation, identity, projects,
permissions, approvals, memory, evidence, recovery and evolution. An
execution provider owns only the inner model/tool loop. The user-facing
workspace therefore has product modes (for example, 通用 and 设计), not a
visible Codex/Native engine switch.

## Contract

Every provider must project the same lifecycle events through
`_record_react_trace_event`:

- one `turn_id` and one ordered event stream;
- tool start/end pairs with a stable call id;
- terminal status and an explicit outcome reason;
- file changes and verification evidence;
- tenant and owner scope from the authenticated session;
- provider/engine metadata on every trace event.

Codex App Server notifications already cross the anti-corruption adapter in
`runtime/execution/codex_backend/events.py`; Native ReAct uses the same bridge.
The bridge now tags both streams with `engine` and the effective model so
evaluation and replay do not infer execution from UI state.

## Learning boundary

Provider-specific loops must not own the only self-evolution hook. Native and
Codex terminal turns use the same coarse score writer in
`runtime/sensing/gateway/_tool_bridge_scoring.py`. The writer is idempotent by
`turn_id`, preserves the authenticated tenant scope, and runs the existing
zero-cost regression tick. Fine-grained skill promotion should consume the
same durable trace stream once Codex tool receipts are available to the
journal adapter.

## Routing policy

- Codex is the default provider for code and complex tool work.
- Native Lite remains for local/offline or domestic-model execution, device
  control, deterministic workflows, and fail-closed fallback before a write
  side effect.
- Shadow comparison is read-only and never runs two mutating providers against
  the same workspace concurrently.
- A provider failure after a side effect is terminal until the effect ledger
  proves an idempotent continuation; it must not silently switch engines.

## Capability admission (2026-09-13)

Routing picks an engine; admission checks the picked engine can structurally
serve the turn. `runtime/execution/engines.py` declares `EngineCapabilities`
per engine (tools, vision, team orchestration, free tier, tool budget,
credential scope), and `verify_engine_admission` rejects an impossible binding
before the engine performs any effect.

Requirements are derived from host-established facts only, never from reading
the prompt. `select_turn_execution` builds them in `turn_capability_request`:

| Requirement | Derived from | Why not the prompt |
| --- | --- | --- |
| vision | image attachment metadata, or `ParsedIntent.modalities` | "看这张图" with no attachment is not a vision task |

`vision` is input-side: can a user-attached image reach the model. It says
nothing about images coming back through tool results — the screenshot tools
already return `ImageContent` over the OpenCode MCP, while the OpenCode turn
driver still sends a text-only prompt.

Team orchestration is deliberately **not** derived from `coordinated`,
`topology_id` or `group_fanout`: those dispatch host schedulers, so the host —
not the engine — runs that orchestration. Deriving it would reject the tested
OpenCode coordinator path.

Behaviour differs by who chose the engine:

- explicit choice → fails closed with `EngineSelectionError(unmet=…,
  alternatives=…)`, so the user learns why their pick cannot run;
- `auto` → rebinds to a capable host path with reason
  `capability_unmet:<requirement>`, because the user never pinned an engine.

Both happen before any effect, so neither is recovery from a failed engine.

> The "Routing policy" section above predates the three-engine host;
> `select_execution_route` is the current authority for ordering.

## Removal gates

The full Native loop can only be reduced after both providers produce complete
traces, verification/repair is provider-neutral, Codex traces enter scoring and
skill promotion, and representative code/design/research/desktop scenarios
pass two release cycles with a rollback route. Until then, Native Lite is a
deliberate execution adapter and experiment surface, not a second product.
