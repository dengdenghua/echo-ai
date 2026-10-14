# Echo Concepts

Echo has a biomimetic kernel, but new readers should not have to learn the
biomimetic names first. This page is the plain-language map.

## One Sentence

Echo is an Agent OS for running, supervising, and evolving AI agents on your
computer.

## The Mental Model

Use this model before learning the internal organ names:

```text
Goal -> Plan -> Execute -> Observe -> Remember -> Improve
```

What each part means:

| Plain term | What it does | Internal name |
|---|---|---|
| Agent OS | Runs and supervises agents as long-lived workers | Echo runtime |
| Workspace | The IDE-like control surface for humans | Frontend / UI |
| Planner | Breaks a goal into steps or a task graph | Cerebrum |
| Reflex Layer | Answers known/simple intents without an LLM round trip | SpinalCord |
| Scheduler | Runs task graphs and coordinates execution | Ganglia（GraphRuntime 已实装；独立 Ganglion 自治层未实装）|
| Agent / Worker | A role-specific AI worker | Arm |
| Skill / Tool | A callable capability used by agents | Sucker / Beak |
| Event Bus | Carries typed events through the runtime | Nerves |
| Memory Store | Persists facts, threads, journal events, and checkpoints | Genome |
| Shared Context | Lets agents coordinate through short-term state | Hemolymph / Blackboard |
| Safety Guard | Checks trust, scope, policy, and risky behavior | Immunity |
| Budget Guard | Stops runaway token, cost, or latency usage | Ink |
| Evolution Loop | Learns from journal history and proposes improvements | Regeneration |
| Strategy Selector | Tests and shifts between prompt/skill variants | Camouflage |
| Model Router | Selects and calls model providers | Eyes |
| IO Gateway | Exposes HTTP, streaming, channels, and UI APIs | Siphon |

## Collaboration and membership

These objects have different authority boundaries. IDs and roles must not be
substituted merely because two surfaces use the word “team” or “workspace”.

| Term | Meaning and authority | Implementation |
|---|---|---|
| Organization | Enterprise membership, department tree and internal channel ACL. Platform read roles do not grant organization writes. | `runtime/workspace/org.py`, `org_store.py`, `/api/orgs`; [management guide](guide/organizations.md) |
| Evolution organization/topology | Agent roles, coordination protocol and evolution proposals; distinct from enterprise membership. | `runtime/safety/organization/`, `topology_router.py`, `/api/organizations/topologies` |
| Internal channel | An organization-owned channel/group with its own membership roles. A channel admin must remain an organization member. | `runtime/sensing/gateway/org_router.py`, `runtime/workspace/org_store.py` |
| External channel | A message adapter/connection such as Slack or WeChat, including pairing and credentials. | `runtime/sensing/gateway/channels_router.py`, `/workspace/channels` |
| Team room | A persistent shared room with agent roster, human participants and speaker policy. Legacy room configuration still has a JSON projection. | `team_rooms_models.py`, `_team_rooms_state.py`, `runtime/memory/cowork/collaboration_store.py` |
| Group/cowork thread | The thread's event-sourced membership and context grants; chat/cluster/swarm selects the response strategy without changing membership. | `runtime/memory/cowork/group.py`, `group_store.py` |
| Project team | The agents assigned to execute a Project OS project; a linked cowork roster can supply the agent pool. | `runtime/projectos/group_execution.py` |
| Workspace mount | An execution/file mount with owner/editor/reviewer/viewer permissions; linking it to a group mirrors those permissions into participant/observer context grants. | `runtime/workspace/model.py`, `store.py`, `group_binding.py` |
| Thread workspace | Per-thread artifact directories and manifest, governed by thread access; distinct from mount membership even when IDs match. | `workspaces_router.py`, `GET /api/threads/{thread_id}/workspace` |
| Workspace UI | The human navigation/control surface. Navigating a UI route does not create a mount or confer its permissions. | `frontend/src/app/workspace/` |

Project OS `group_execution.py` attaches and executes a project with the group
roster; workspace `group_binding.py` mirrors mount membership and compatibility
file events. `topology_router.py` serves evolution topologies; enterprise
membership uses `org_router.py`. These names identify each integration's
authority boundary. In the complete application, `GET /api/workspaces/{workspace_id}`
returns the mount entity and requires the remote-workspace feature flag and
current membership. Thread manifests use `GET /api/threads/{thread_id}/workspace`;
the standalone thread router retains the deprecated `/api/workspaces/{thread_id}`
alias by default, but integrations mounting both routers must disable that alias
with `include_legacy_info_route=False`. Existing artifact output paths remain
available. These distinctions do not imply that every legacy projection has
been migrated.

## Three-Layer Language Rule

Echo uses three vocabularies for three audiences:

| Audience | Use this language | Example |
|---|---|---|
| Users | Outcome language | "Run an agent task and review the result" |
| Developers | Engineering language | "Planner sends a task graph to the scheduler" |
| Kernel contributors | Biomimetic language | "Cerebrum and Ganglia coordinate through Nerves" |

Default to the leftmost language that works. Biomimetic terms are useful once a
reader wants the deeper architecture, but they should not block the first task.

## What Echo Is Not

Echo is not just an IDE, browser, desktop app, or agent framework.

Those are surfaces:

| Surface | Role |
|---|---|
| Desktop App | Delivery form |
| Workspace | Human control room |
| Browser / Extension | A place agents can act |
| OpenAI-compatible API | Integration surface |
| MCP / tools | Capability ecosystem |

The core is the Agent OS: long-running agents, memory, supervision, safety,
budgeting, and improvement loops.

## First Principles

Keep these in mind when reading the code:

1. Fast path before slow path. Known work should use reflexes before LLM calls.
2. Every meaningful action should leave an event trail in the journal.
3. Agents should be supervised: scoped, budgeted, cancellable, and inspectable.
4. Skills are capabilities, not magic. They should be testable and auditable.
5. Memory should improve future work without hiding what changed.
6. Evolution is proposed and reviewed; it is not blind self-modification.

## Where To Go Next

- First hands-on task: [GOLDEN_PATH.md](GOLDEN_PATH.md)
- Existing quick start: [../QUICKSTART.md](../QUICKSTART.md)
- Naming contract: [naming.md](naming.md)
- Full architecture: [guide/architecture.md](guide/architecture.md)
