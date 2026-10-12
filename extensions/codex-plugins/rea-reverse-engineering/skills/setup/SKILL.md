---
name: setup
description: Set up or repair the REA reverse engineering plugin for Codex, including its local runtime, Android engine, and analysis-provider paths.
---

# REA plugin setup

This package provides upstream `rea` and additional `rea-deep` MCP servers with the investigation skill. Resolve the plugin root from this file (`../..`).

Run `node <plugin-root>/scripts/rea.mjs --paths` to inspect selected paths. If the runtime or headless JADX JAR is absent, run `node <plugin-root>/scripts/setup.mjs`. On macOS, `--engines` also installs Ghidra, Apktool, JADX CLI and ripgrep through existing Homebrew when dependency installation is within the user's requested scope. Java and Ghidra are unnecessary for static JavaScript inspection.

The durable Android tools run on macOS/Linux with Python 3.9+. JADX CLI is separate from the upstream headless JADX MCP JAR. SDK build-tools `apksigner` is discovered for signature validation; if absent, the workspace records that limitation. Keep the user's existing engine paths. Use `REA_JADX_COMMAND`, `REA_PYTHON_COMMAND` and `REA_APKSIGNER_COMMAND` for custom deep-engine locations; `rg` must be on PATH.

The launcher preserves caller-supplied environment settings and discovers common Homebrew JDK 21/Ghidra paths, Android Studio's JDK, and Android SDK adb. Nonstandard installations can set `JAVA_HOME`, `GHIDRA_INSTALL_DIR`, `REA_JADX_MCP_JAR`, `REA_APKTOOL_COMMAND`, and `REA_ADB_PATH` in their launch environment.

Use `node <plugin-root>/scripts/rea.mjs doctor --provider ghidra --format json` only when native analysis needs diagnosis. Android readiness is established by the requested Android operation; the generic doctor does not diagnose JADX.

Do not create a second standalone `mcp_servers.rea` registration with upstream `rea setup`. This plugin owns the MCP connection. If tools are absent after installation, continue the user's investigation through `node <plugin-root>/scripts/rea.mjs <command>` where useful, and explain that a new chat or restart is needed to load the plugin tools.

For deep tool fallback use `node <plugin-root>/scripts/rea.mjs deep <action> <JSON>`. Preparing a workspace starts an owned background worker and returns quickly; check `deep status`, or `deep cancel` to stop only that worker. Artifacts, engine output, indices and evidence belong in the caller-selected workspace, never in the plugin cache. On a reported failed/partial stage, resolve its concrete cause and resume with `retry_failed: true`; do not erase the workspace.

Analysis engines run locally. Tool results used by the agent can be sent to its model provider; do not describe a cloud-model workflow as fully offline.

Visual/UX tools also use Python 3.9+ and local file locks. Direct device captures/actions need `REA_ADB_PATH` and an explicit connected serial; imported PNGs need no Android engine. Capture/inspect the current app before a single observed action. Use `deep audit-*` CLI fallback until new MCP tools load.
