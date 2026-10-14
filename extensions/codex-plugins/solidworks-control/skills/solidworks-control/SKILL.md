---
name: solidworks-control
description: Control this Windows machine's SolidWorks session through the bundled local MCP - exact-document inspection, declarative part modelling, assemblies, drawings, CAD exports and Flow simulation, all funnelled through one serialised COM job queue. Use for any SolidWorks session work on this machine.
---

# SolidWorks 本地控制

## Connect and identify the document

- Read `sw_health` first: it reports SW/importer/solver processes and the job lock without
  touching COM, so it stays safe during a long import or solve.
- Read `sw_session` to get real document paths, titles and dirty flags. Select the exact
  path or a unique title; the active document is never an implicit target.
- Call `sw_start` only when no SW process exists. If a process exists but COM is
  unreachable, inspect the session/elevation mismatch instead of starting a duplicate.
- A scratch/leftover document is only ever the one this plugin created; the user's open
  models are never closed, and `sw_close_clean` refuses anything with unsaved changes.

## Job contract

- Every CAD tool returns a `job_id` and is serialised machine-wide. Poll `sw_job_status`;
  a `submitted` reply never means the model was built.
- Read the nested result: status, errors, warnings and the actual measured geometry.
  A `completed` job with `verified: false` is not a successful model.
- Never retry a mutation because a request timed out, and never delete the lock by hand.
  A dead worker with no result is only released through `sw_acknowledge_dead_job`, and
  only after no SW/importer process remains.
- Native inputs open read-only by default; outputs and copies always require NEW absolute
  paths and existing files are never overwritten.

## Part modelling

`sw_create_part(plan, output_path)` builds a NEW part from a millimetre JSON plan and
verifies it before saving. Plan and schema: [references/modeling-plan.md](references/modeling-plan.md).

- Sketch entities: `line`, `rectangle` (centre), `corner_rectangle`, `circle`, `arc`,
  `polygon`, `slot`, `spline`. A sketch-driving feature needs a CLOSED contour.
- Features: `extrude_boss` (blind or `through_all`), `extrude_cut` (blind or
  `through_all`), `extrude_midplane`, `fillet`, `chamfer`, `shell`.
- Reference a sketch by its 1-based index in `sketches` or by a literal sketch name.
  Reference an earlier feature the same way for patterns.
- `fillet`/`chamfer` take `"edges": "all"` or point picks `[{"point": [x, y, z]}]` in mm;
  the nearest edge is selected. `shell` takes `"faces": "none"` for a closed shell or
  point picks to open it.
- Always supply a `verify` block. Without one the geometry is measured but `verified`
  stays false, because nothing was compared against an expectation.
- Prefer an analytic expectation (a volume you can compute) over a self-referential one.
  A plan that fails discards its own unsaved scratch document, so a failure leaves no
  half-built part behind and writes no file.

### Not supported - do not fake it

Measured on this build (SOLIDWORKS 2026 SP3.2, COM revision 34.3.2): the pattern and
mirror APIs return `False` and change NOTHING, while reporting no error. The tools
therefore refuse them rather than silently emitting a part that lacks the pattern.

- `linear_pattern`, `circular_pattern`, `mirror_feature` are unsupported.
- Instead, put every repeated or mirrored entity in ONE sketch. A 3-hole array and a
  4-hole plate built that way matched their analytic volumes exactly.
- `arc` and `spline` sketch fine, but a closed contour made from them was not verified;
  use `circle`/`slot`/`polygon`/`corner_rectangle` or an explicit loop of `line` entities
  for a contour that must extrude.
- `hole_wizard` is a stub in the local helper library and is not exposed here; model a
  counterbore or a tapped hole as explicit circles, or use the worker UI.

## Assemblies, drawings, exports

- `sw_create_assembly(plan, output_path)` adds components at mm offsets, applies
  `coincident`/`concentric`/`distance`/`parallel` mates (exact entity names such as
  `Face1@Part1-1`), fixes what you ask it to, then saves. Mate error codes are NOT read
  there: run `sw_mate_status` on the saved assembly before trusting the fit, and
  `sw_interference` before calling the fit intentional.
- `sw_create_drawing(plan, output_path)` makes a drawing from an existing model with
  standard or named views, notes, and optional PDF export.
- `sw_save_copy` writes native copies and STEP/Parasolid/STL exports to NEW paths.
  An assembly copy is not Pack and Go; it still references the original dependencies.
- `plan.exports` accepts `step`, `stl` and `pdf` alongside the native save.

## Inspect and review before claiming success

- `sw_inspect` reads features and solid bounds; `sw_components` lists top-level assembly
  components with reference paths, suppression and transforms.
- `sw_view` writes a BMP preview - look at it. `sw_interference` and `sw_mate_status`
  report what the geometry actually does.
- Geometry that rebuilt, saved and exported is still not a reviewed design. State what
  was measured, and what remains unverified.

## Flow simulation

- Treat installed files, loaded add-in, readable project, running solver, completed solve
  and converged results as six separate pieces of evidence.
- Before solving, the model directory is archived in full to a NEW outside directory;
  unsaved in-memory changes are recorded, never silently saved or discarded.
- Do not run other CAD mutations while a solver runs, and never retry a failed solve.
- A completed job with `solver_execution_verified: false` is NOT a solved case, and
  convergence is not proof that the user's thermal design is validated.

## Runtime

Runtime `D:\AI\SolidWorksMCP` holds the job queue, logs and validation evidence; this is a
machine-specific plugin, not a portable SolidWorks installation. Sources: `server.py`
(MCP surface), `worker.py` (COM dispatch), `model_tools.py` (declarative modelling),
`jobs.py` (durable single-writer broker).

If a conversation has not loaded the plugin MCP yet, the CLI fallback is:

```powershell
& 'D:\AI\SolidWorksMCP\.venv\Scripts\python.exe' 'D:\AI\SolidWorksMCP\swctl.py' session --wait 10
```

Pass parameters as a UTF-8 JSON file with `--args-file` and poll with `status --job-id ID`.
Upstream projects this work was compared against: [references/upstream-research.md](references/upstream-research.md).
## Echo integration

In Echo, discover the registered tools with `search_capabilities` before use. The MCP tool names carry the `mcp_solidworks_local_` prefix; all arguments and operating rules above still apply. Read this skill and its references before changing a document.
