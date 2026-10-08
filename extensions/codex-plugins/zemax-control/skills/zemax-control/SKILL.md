---
name: zemax-control
description: Control local Ansys Zemax OpticStudio through ZOS-API MCP for lens modeling, optical analysis, optimization, tolerancing and non-sequential ray tracing. Use for Zemax or OpticStudio design and automation tasks.
---

# Zemax Control

Use the plugin's `zemax_*` MCP tools. The Python server starts without opening OpticStudio; an installed Windows OpticStudio and a valid ZOS-API license are required to connect.

## Connection

- Call `zemax_environment` first for local detection, then `zemax_info` if a session may already exist. Reuse one persistent connection.
- For the live GUI, use `zemax_connect(mode="extension")`. OpticStudio must have Programming > Interactive Extension listening. If it is not listening, explain this precise prerequisite; do not repeatedly reconnect or start additional CAD applications.
- Use standalone mode for requested batch work when the license permits. Do not infer API license entitlement from edition names. Report the actual connection error.
- `ZEMAX_ROOT` is the Zemax DATA directory containing `ZOS-API/Libraries/ZOSAPI_NetHelper.dll`, not necessarily the application install directory.
- `zemax_disconnect(save=True)` saves before disconnecting. Explicit Save-As with an absolute path is preferable for deliverables.

## Working with models

Inspect `zemax_info` and the LDE/NSC summary before edits. Identify the exact file and sequential/non-sequential mode. For modifications to existing work, create a working copy with `zemax_save_file(path=...)` before edits unless the user requested edits to the original. Opening or creating a system replaces the active system; preserve unsaved work first.

Set or inspect aperture, fields, wavelengths, materials and units before evaluating a design. Wavelength inputs are in micrometers; field coordinates depend on field type; lens dimensions follow the system's units. Surface numbers follow the Zemax editor; wavelength and configuration indices generally start at 1.

Release only variables relevant to the design, configure the merit function and manufacturing constraints, record a baseline, then optimize. Recheck image quality across all requested fields and wavelengths; a lower merit value alone does not establish that specifications are met. Use analysis tools to obtain actual results and report assumptions and unverified requirements.

The bundled upstream tools cover LDE edits, spot RMS, analysis series, optimization, MCE, TDE, batch rays and NSC detector data. Discover tool schemas before calling them. For missing API operations, `zemax_eval` executes Python with `TheSystem`, `TheApplication`, `ZOSAPI`, and `z`; assign a JSON-serializable value to `result`. Use it only within the current task. It is arbitrary local Python execution, not a sandbox. Verify uncertain API members using installed version documentation.

Save final lens files to an explicit absolute output path and verify their existence. Return actual analyses and paths; distinguish protocol-level validation from real optical validation. Do not describe upstream author test claims as tests performed on this machine.

## Sources and setup

Read [references.md](references.md) for official docs and source provenance. Plugin-root README.md describes the local runtime, setup and validation. No vendor binaries or optical catalogs are bundled.

## Echo integration

In Echo, discover the registered tools with `search_capabilities` before use. The MCP tool names carry the `mcp_zemax_` prefix; all arguments and operating rules above still apply. Read this skill and its references before changing a document.
