# Echo migration

Source: personal/solidworks-control/0.2.0+codex.20260921125028 from the user-owned Codex plugin cache.
Echo version: 0.2.0+echo.20260925. Skills, references and MCP interfaces are preserved.

Install using `tools/install_personal_cad_plugins.py` in the Echo repository. The installer resolves local paths, verifies the MCP tool inventory, records trust for that exact inventory, and saves previous plugin versions through Echo lifecycle transactions. It configures Echo startup MCP servers; it does not open or modify CAD documents.

Host regression coverage: `tests/test_personal_cad_plugins.py`, `tests/test_mcp_persistent.py`, `tests/test_codex_plugin_smoke.py`. No CAD application, license, model, credential or vendor library is bundled.
