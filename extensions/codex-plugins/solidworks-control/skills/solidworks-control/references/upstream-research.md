# Upstream research: SolidWorks MCP servers and agent skills

Survey run 2026-09-21 against the GitHub search API
(`/search/repositories?q=solidworks+mcp&sort=stars&order=desc`, 92 repositories
matched). Star counts, licences and last-push dates below were read back from the API
on that date; re-check them before quoting this page.

This page records what already exists, what this plugin reused, and where it
deliberately differs. It is a comparison, not an endorsement.

## What was already out there

| project | stars | lang | licence | last push | what it is |
| --- | --- | --- | --- | --- | --- |
| `wzyn20051216/solidworks-automation-skill` | 967 | Python | MIT | 2026-09-21 | `SKILL.md` + `subskills/` + `mcp-server/` + `scripts/`, version 1.3.0. The ancestor of the local `solidworks-agentic-automation` skill. |
| `eyfel/mcp-server-solidworks` | 333 | Python | AGPL-3.0 | 2026-09-10 | COM MCP server. Copyleft - cannot be vendored into this plugin. |
| `vespo92/SolidworksMCP-TS` | 230 | TypeScript | MIT | 2026-09-20 | Node/TypeScript MCP server. |
| `alisamsam/Solidworks-MCP` | 138 | Python | MIT | 2026-03-23 | Python MCP plus `solidworks_com.py` bridge. |
| `andrewbartels1/SolidworksMCP-python` | 78 | Python | MIT | 2026-09-18 | Broad Python MCP surface. |
| `Cai-aa/CAD-Agent-Hub` | 68 | Python | MIT | 2026-09-07 | Multi-CAD hub: CATIA, SolidWorks, NX, Fusion. |
| `arthurle3210/swapi-pilot-solidworks-mcp` | 30 | - | - | 2026-07-05 | SolidWorks API pilot server. |
| `just1step/solidworks-mcp` | 26 | C# | MIT | 2026-04-10 | .NET MCP server. |
| `sina-salim/AI-SolidWorks` | 24 | Python | none declared | 2025-04-20 | Early local automation, no licence file. |
| `Xuan-BOMS/soildworks-mcp` | 24 | Python | MIT | 2026-04-24 | Explicitly packaged for Codex/stdio: Python stdio server plus a C# bridge. |
| `almightyshui/Mechanical-AI-Skill` | 22 | Python | MIT | 2026-06-17 | Mechanical-engineering agent skill. |
| `HarrierPigeon/Solidworks-MCP-Server` | 18 | Python | MIT | 2026-08-14 | - |
| `jianzhichun/solidworks-mcp-server` | 18 | TypeScript | MIT | 2025-12-23 | - |
| `Slacker-LLC/solidworks-mcp` | 13 | Python | Apache-2.0 | 2026-08-16 | 92 tools; attaches to a session that is **already running**; returns screenshots as images. |

The distribution is the important part: most servers are thin COM wrappers, the
star ranking is dominated by one skill-plus-server bundle, and only a couple
publish a tool count or a stated safety posture at all.

## Primary references used

- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) - the `mcp`
  package this plugin's server is built on (`mcp>=1.27,<2` matches the ancestor's pin).
- Codex plugin and MCP configuration documentation - `mcpServers` in `.mcp.json`,
  marketplace registration through `codex plugin add`.
- The SolidWorks API help installed with this seat (SOLIDWORKS 2026 SP3.2, COM
  revision 34.3.2). Every API behaviour claimed in this plugin was measured on that
  build, not copied from a vendor example.

## What was reused

- `solidworks-agentic-automation` (local skill) derives from
  `wzyn20051216/solidworks-automation-skill`, MIT. The attribution is recorded in that
  skill's `NOTICE` and its `LICENSE` is preserved. The COM helpers validated there -
  `sw_part.py`, `sw_assembly.py`, `sw_export.py`, `sw_drawing.py`, `sw_connect.py` -
  are the reference for how this plugin calls the API, including the
  property-versus-method ambiguity helper and the empty-callout pattern for
  `SelectByID2`.
- `Slacker-LLC/solidworks-mcp` confirms the same core stance independently: attach to a
  running session over COM, never launch SolidWorks, never register an add-in. Its
  Apache-2.0 code was **not** copied here; only the posture was adopted.
- `Xuan-BOMS/soildworks-mcp` is the closest match in packaging intent (Codex, local
  stdio). Its Python-plus-C# two-process design was considered and rejected in favour of
  a single Python process with a durable job broker.

## Where this plugin differs

These are the decisions taken here that the surveyed projects mostly do not make. They
are the reason to keep this plugin rather than install one of the above.

- **Serialised, durable job queue.** Every mutation returns a `job_id` and is serialised
  machine-wide through `cad.lock` and `jobs/<32hex>/`. A timeout never means the build
  failed, a dead worker is only released explicitly, and no retry is automatic. A thin
  COM wrapper has no equivalent, which is how two agents corrupt one session.
- **Declarative millimetre plan instead of a wide tool surface.** One `sw_create_part`
  takes a JSON plan; the alternative in the ecosystem is a tool per feature (92 in the
  largest surveyed server). Fewer tools cost fewer tokens to describe and make the model
  reproducible.
- **Verification is part of the contract.** A plan carries a `verify` block compared
  against measured volume and body count; `completed` is not success and `verified:
  false` is reported as such. The surveyed servers largely report that a call returned.
- **Measured refusals.** `linear_pattern`, `circular_pattern` and `mirror_feature` return
  `False`, change nothing and raise no error on this build. This plugin refuses them and
  names the verified alternative instead of emitting a part that silently lacks the
  pattern - the failure mode a per-call tool surface cannot detect.
- **Read-only inputs, new paths only.** Native models open read-only by default and no
  output path is ever overwritten, so the user's open work cannot be clobbered.

## Sources

- GitHub search API, 2026-09-21: `q=solidworks+mcp`, sorted by stars, 92 results.
- Repository metadata and file trees read back per project on the same date.
- `C:\Users\Administrator\.codex\skills\solidworks-agentic-automation\NOTICE` for the
  MIT attribution chain.
- Live measurements on this seat, recorded under
  `C:\Users\Administrator\Documents\SolidWorks-AI\mcp-model-test-20260921\`.