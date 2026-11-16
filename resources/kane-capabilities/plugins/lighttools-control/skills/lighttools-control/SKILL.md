---
name: lighttools-control
description: Control local LightTools on Windows through LTAPI4 COM and the lighttools MCP, for optical model construction, parameter edits, illumination ray tracing, and receiver data extraction.
---

# LightTools control

Use the `lighttools` MCP for the local LightTools installation. This is a custom integration built on the official API, not an official vendor MCP. Its source is bundled in this Echo plugin; resolve the plugin root from the loaded skill path.

## Session and job workflow

- Call `lt_environment`, select the intended running PID, then `lt_connect(pid)`. When absent use `lt_start`; use `lt_start(new_session=true)` for an isolated task. Do not create `LightTools.LTAPI4` directly to attach: it can launch an extra session.
- The earlier Core startup error on this machine was traced to the stopped local license service. Starting the already-configured service restored the license endpoint and a checked LTAPI4 connection. Check service reachability and vendor logs before inferring feature or concurrent-session limits; see the troubleshooting reference. Do not repeatedly launch instances while licensing is unavailable.
- COM operations return a `job_id`. Poll `lt_job_status` with brief intervals for short jobs, backing off to several seconds for tracing. Only `completed` confirms success. `failed` includes API status and whether a mutation started; inspect the outcome before resubmitting a mutation. A lost connection or timeout does not cancel the COM job.
- Pass the returned `active_view` as `expected_view`. Update it after new/open/save operations. A mismatch stops the operation before it changes the model. PID identifies a process; the view check guards against operating after the user switches context. Do not silently accept a changed context.
- `New3DDesign` and `Open` replace the current system. Their dedicated tools first save a recovery `.lts` under the server's `recovery` directory. For a separate working model, start a new session. Save requested results with `lt_save_copy` to a new absolute `.lts` filename; existing files are rejected.

## Reading objects with repeated names

Use `lt_read_object_fields` when reading fields from enumerated objects, especially repeated spectral-region names. It reads the temporary native handles inside the same list/job lifetime and returns each field's API status. A completed batch can contain failed fields; preserve those statuses instead of substituting zero. `compare_paths=true` also reads the returned paths for diagnosis: a path can fail or resolve ambiguously while the native handle succeeds. Neither paths nor enumeration indices prove a stable physical identity. Handles stay internal and must not be stored for later calls. The read is bounded to 100 objects and 10 fields; retain `count`, `returned` and `truncated` when describing coverage. Optional `i`/`j` retain vendor semantics, which must be checked for the particular field.

## Modeling and analysis

Inspect the model and current length units before entering dimensional geometry: read `UNITS` on `LENS_MANAGER[1]`. Use `lt_schema` on the relevant database object to discover other field names and values; `lt_db_get`/`lt_db_set` support the optional vendor `i`/`j` indices. LightTools database indices are commonly 1-based. Treat units and array orientation as properties of the actual model/API, not assumptions inferred from the filename.

Prefer `lt_objects` for object discovery and checked parameter tools for changes. For a modeling operation without a dedicated wrapper, look up the command with `lt_docs_search(section="cmd")` and read it with `lt_docs_read`, then call `lt_command` once. Do not guess command syntax or use commands to bypass the dedicated file operations.

For scalar writes requiring equality, discover `lt_set_verified`; for read-only assertions use `lt_verify_fields`. Inspect their verification results. When editing scattering, moving groups or inserting optics, read [verified model edits](references/verified-model-edits.md) for shared-property, coordinate, rebuild and path checks. These tools do not automatically clone properties or resolve ambiguous object paths.

Before tracing, verify sources, receivers, material/optical properties and simulation settings. `lt_ray_trace` runs all enabled simulations. Read the receiver mesh after the trace to validate the result, using the metric appropriate to the task (flux, illuminance, intensity, etc.). For `CellFlux`, report the mesh sum, `TotalPower`, their difference, and native `TOTAL FLUX ERROR` separately: the mesh estimate can differ from total incident power. Do not sum irradiance cells and report that as total flux. `lt_export_mesh_csv` preserves the LTAPI4 array orientation without transposing or flipping; confirm spatial axes from the model when plotting.

Read [references/api.md](references/api.md) for unfamiliar API return shapes, local documentation locations, or troubleshooting. If the newly installed MCP is not yet visible, refresh MCP connections or start a new chat; the installed Python entry point can also be used through the official MCP client for diagnostics.

For parent-bound child tables, use `lt_read_child_fields` after the tool has been discovered on the active connection. It keeps both native lists alive while reading and returns parent identity fields and child counts, truncation and per-field statuses. Do not treat NUM WAVELENGTHS or MIN/MAX metadata as the actual child table size/domain; read the real WAVELENGTH children. See [API reference](references/api.md) for bounds and completeness.

## Echo integration

In Echo, discover the registered tools before use. MCP names carry the `mcp_lighttools_` prefix. Read this skill and its references before changing a document; the tool schemas and operation rules above still apply.
