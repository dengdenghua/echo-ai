# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Versions follow [SemVer](https://semver.org/), pre-1.0 so breaking changes are allowed.

---

## [0.1.0] — 2026-09-13

Bootstrap release of **Echo AI** as a standalone project.

- `runtime/` Python agent runtime: planning, execution, observation, memory,
  safety governance, self-improvement loop.
- Workbench frontend, browser relay extension, PluginHub marketplace.
- Nine mechanical ratchet gates under `tools/lint/` with
  `run_gates.py` as the single entry point.
- Rebrand: distribution `echo-ai-runtime`, env prefix `ECHO_*`, home
  directory `~/.echo`. All 15,808 legacy brand references replaced.
