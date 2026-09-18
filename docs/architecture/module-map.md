# Organ Directory Map

This file maps the biomimetic architecture vocabulary to the current
implementation package locations.

The runtime was reorganized into seven semantic groups. New code should import
from the grouped paths below, for example `runtime.execution.tool_engine` instead of the
old flat `runtime.beak`. Backward-compatible re-exports still exist in
`runtime/__init__.py` for older callers.

Every package below has been verified to exist in the current tree. Some
early biomimetic names were retired in favour of functional ones — the
concept is shown in parentheses where the directory no longer carries the
old name.

| Organ / concept | Current implementation package |
|---|---|
| `cerebrum/` | `runtime/core/cerebrum/` |
| `ganglia/` (TaskGraph runtime) | `runtime/core/graph_runtime/` |
| `spinal_cord/` (reflex layer) | `runtime/core/nerves/reflex/` |
| `nerves/` | `runtime/core/nerves/` |
| `hearts/` | `runtime/core/hearts/` |
| `agents/` | `runtime/execution/agents/` |
| `arms/` | `runtime/execution/arms/` |
| `beak/` (tool execution) | `runtime/execution/tool_engine/` |
| `suckers/` | `runtime/execution/suckers/` |
| `parallel_agents/` | `runtime/execution/parallel_agents/` |
| `swarm/` | `runtime/execution/swarm/` |
| `tentacle/` | `runtime/tentacle/` |
| `siphon/` (realtime gateway) | `runtime/sensing/gateway/` |
| `model_router/` | `runtime/sensing/model_router/` |
| `normalize/` | `runtime/sensing/normalize/` |
| `server/` | `runtime/sensing/server/` |
| `hemolymph/` | `runtime/memory/hemolymph/` |
| `knowledge_graph/` | `runtime/memory/knowledge_graph/` |
| `threads/` | `runtime/memory/threads/` |
| `journal/` | `runtime/memory/journal/` |
| `immunity/` (trust engine) | `runtime/safety/auth/` |
| `invariants/` | `runtime/safety/invariants/` |
| `regeneration/` (recovery) | `runtime/safety/recovery/` |
| `chromatophores/` | `runtime/safety/chromatophores/` |
| `channels/` | `runtime/adapters/channels/` |
| `integrations/` | `runtime/adapters/integrations/` |
| `mcp_client/` | `runtime/adapters/mcp_client/` |
| `scheduler/` | `runtime/adapters/scheduler/` |
| `instrumentation/` | `runtime/adapters/instrumentation/` |
| `config/` | `runtime/platform/config/` |
| `models/` | `runtime/platform/models/` |
| `ui/` | `runtime/platform/ui/` |
| `i18n/` | `runtime/platform/i18n/` |

Retired biomimetic names with no current dedicated package: `eyes`, `skin`,
`mantle`, `genome`, `ink`, `camouflage`.

## Runtime Path

Workspace turns enter through the realtime gateway and bind one execution
engine through `select_turn_execution` and `ExecutionSupervisor`. Local
deployments default to OpenCode; non-local deployments default to Echo unless
configured otherwise. Explicit task choices and role bindings affect selection.

```text
request
  -> sensing/gateway/realtime_gateway
  -> sensing/gateway/realtime_turn_lifecycle
  -> select_turn_execution + ExecutionSupervisor
  -> OpenCode process / Codex App Server / Echo ReAct
  -> host tools, permissions, budgets and verification
  -> journal + item protocol events

explicit project/team orchestration:
request
  -> host project_os / group_fanout / swarm_mesh scheduler
  -> member execution engines
  -> shared evidence and task results
```

`chat`, `react` and `deep` alone stay on the single-agent path; a `deep` label
does not select DAG execution. Native reflex/ReAct and GraphRuntime remain
available within their configured paths. Engine capability fallback before
execution preserves any host project/team scheduler.

### Three naming systems, one execution

"Mode" names three orthogonal things. They are not layers of one concept, and
reading one as another is the most common way to misjudge what a turn will do.

| Layer | Values | Owner | What it decides |
| --- | --- | --- | --- |
| `AgentModeName` | `develop`, `audit`, `uxui` | `frontend/src/core/agent-modes/presets.ts` | Prompt/preset persona. No effect on routing. |
| `TeamMode` | `chat`, `cluster`, `swarm`, `project` | `frontend/src/components/workspace/team-mode-picker.tsx` | The user's per-turn *intent*, sent as a request field. `project` is migration-only — `normalizeTeamResponseMode` folds it to `chat`. |
| `PatternExecution` | `presence`, `focused`, `fanout`, `orchestrated` | `runtime/execution/agents/team_patterns.py` | Server-arbitrated truth, from `select_team_pattern`. |
| Execution driver | `react`, `project_os`, `group_fanout`, `swarm_mesh`, `opencode_server`, `codex_app_server` | `select_execution_route` in `runtime/execution/engines.py` | What actually runs. |

`select_team_pattern` → `PatternExecution` is fixed
(`TEAM_PATTERNS`, team_patterns.py:123-161):

| Pattern | Execution | Rounds |
| --- | --- | --- |
| `presence_check` | `presence` | 0 |
| `focused_reply` | `focused` | 1 |
| `parallel_roundtable` | `fanout` | 1 |
| `adversarial_review` | `fanout` | 2 |
| `coordinated_execution` | `orchestrated` | 1 |

`PatternExecution` then reaches a driver through `select_execution_route`,
whose precedence is `project_command` > `group_fanout` > `topology_id` >
`coordinated` (engines.py:274-286). Two consequences worth holding onto:

* `orchestrated` does **not** reach a dedicated driver. It sets `coordinated`,
  which routes to the *coordinator's own engine* (`react` /
  `opencode_server` / `codex_app_server`), and the delivery-completeness gate
  audits it as `orchestrated` (realtime_turn_lifecycle.py:1394).
* `topology_id` outranks `coordinated`, so a stale client-supplied
  `topology_id` would dispatch `swarm_mesh` while the turn is still audited as
  `orchestrated`. `realtime_turn_lifecycle.py:1080-1094` clears it under
  server-owned `focused`/`orchestrated` patterns for exactly that reason.

`serve_mesh` and `topology_id` are compatibility inputs, not intent:
`serveMeshForMode` maps cluster→`"0"` and swarm→`"1"`
(team-mode-picker.tsx:90-94), and `serve_mesh == "1"` is only a *fallback*
condition for `group_fanout` when no server pattern was produced
(realtime_turn_lifecycle.py:1173-1186).

Known label/semantics gap: the zh-CN strings describe cluster as
"队长拆解→分派→汇总" and swarm as "并行共创", but swarm falls through to
`group_fanout`, which states outright that it is still conversation rather than
a task graph (`runtime/execution/agents/group_fanout.py:12-15`). Whether the
copy or the mapping is wrong is a product decision and is still open.

## Practical Navigation Guide

- Realtime transport: `runtime/sensing/gateway/realtime_gateway.py`
- Realtime runtime bridge: `runtime/sensing/gateway/realtime_cerebrum.py`
- Thread event log and replay: `runtime/memory/threads/`
- Compatibility chat/thread/team APIs: `runtime/sensing/gateway/` (channels_router, team_tasks_router, …)
- Tool execution and governance: `runtime/execution/tool_engine/executor.py`
- Skill catalog: `runtime/execution/all_skills/__init__.py`
- Write-scope permissions: `runtime/platform/process/scope.py`
- Frontend route source of truth: `frontend/src/router.tsx`
- Frontend realtime state: `frontend/src/core/realtime/`
- Frontend conversation and team pages: `frontend/src/app/workspace/`
- Tests: `tests/`

## Migrated Canonical Notes

Some root-level organ notes have already been consolidated under
`docs/architecture/organs/`.

- `beak`
- `camouflage`
- `cerebrum`
- `chromatophores`
- `ganglia`
- `hearts`
- `hemolymph`
- `ink`
- `skin`
- `spinal_cord`
