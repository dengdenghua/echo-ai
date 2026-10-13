# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Versions follow [SemVer](https://semver.org/), pre-1.0 so breaking changes are allowed.

---

## [0.2.0] — Unreleased

First stable release after the v0.1.0 pre-release, covering the desktop
work client, the shared runtime and the release pipeline.

### Added

- **Work locations and execution nodes.** A chat turn can run on this
  machine, on a selected execution node, or over SSH / WSL, picked from the
  folder control in the composer (local work location flags stay off by
  default).
- **AI browser.** Start page as an AI entry point; the assistant reads the
  page, other tabs and selections; find, reader mode, bookmarks bar, pinned
  and private tabs, tab groups, split view, restored history, saved logins,
  and real Chrome / Edge extensions installed from the stores.
- **Collaboration and projects.** Shared rooms with one authoritative
  transcript, presence and recoverable transcript import; group input
  queued across realtime workers; organization membership and channel
  management; Project OS with owner-reviewed unattended progress, daily
  attention, supervised background HTTP jobs and canonical team-task
  authority.
- **Multi-device.** Verified device-to-device task handoffs, resumable
  transfers and per-device hub credentials (Echo Mobile pairing).
- **Engines.** Codex 0.162 runtime (alongside the vetted 0.149 bundle) and
  OpenCode 1.18.29, both pinned and shipped inside the desktop installer.
- **Chat.** Message actions with reply quotes, a context-window breakdown
  under the composer, notifications when a long task needs you, and an
  opt-in streaming debugger (Ctrl+Shift+D).
- **HUB.** Local roles and migrated catalog discovery in one place,
  dependency validation with readiness checks, CAD / optics Codex control
  plugins.

### Changed

- The product is named **ECHO AI** (the default agent stays **Echo**), with
  the ECHO family identity: monogram avatars instead of emoji, line icons,
  one Echo orb mark and AA contrast.
- The 订阅 workbench app is now **自动化** (Automation); the workflow route
  redirects to Hub skills.
- Stores use versioned SQLite migrations; Windows child processes and
  scheduled commands run inside Job Objects.
- Release builds: the Windows installer, its backend, Codex and OpenCode
  executables are Authenticode-signed and re-verified by `release.yml`;
  the Linux AppImage is named `Echo-Setup-Linux-<version>-<sha>.AppImage`.

### Security

- Approvals: a refused network request stays refused for the turn across
  every tool, shell `curl` and sandbox escalation; 自动审批 reviews every
  network call; consent binds to pending task requests.
- Auth: session revocation, login throttling and webhook authentication;
  every WebSocket handshake goes through one gate; passwordless dev login is
  limited to this machine; the desktop shell signs the owner in with a
  shell-held token.
- Workspaces never return mount credentials over HTTP, gate local mounts,
  block SSRF and verify SSH host keys; thread access is authorized per
  thread.
- Dependency audit clean (`pip-audit`, `pnpm audit --prod`, Bandit
  MEDIUM+ at zero).

### Fixed

- Realtime replays no longer duplicate answers; OpenCode Zen / Go calls are
  authenticated and free models are derived from per-provider prices.
- An ordinary account sees its own knowledge graph instead of a 403.
- Codex on Windows starts a fresh thread when the resume sandbox is refused
  and finds the vetted bundle instead of the desktop app.
- Many UI, i18n (en-US, zh-CN, ja-JP, ko-KR) and Windows path fixes.

### Known issues

- Signed marketplace content (`echo-content`) is not published yet: plugin
  installs from the store need `ECHO_MARKETPLACE_DEV_SOURCES=1` in
  development until the signing keys are configured.
- macOS builds are not produced by CI; the DMG target exists in
  `packaging/desktop/build.yml` but is unsigned and untested.

## [0.1.0] — 2026-09-13

Bootstrap release of **Echo AI** as a standalone project.

- `runtime/` Python agent runtime: planning, execution, observation, memory,
  safety governance, self-improvement loop.
- Workbench frontend, browser relay extension, PluginHub marketplace.
- Nine mechanical ratchet gates under `tools/lint/` with
  `run_gates.py` as the single entry point.
- Rebrand: distribution `echo-ai-runtime`, env prefix `ECHO_*`, home
  directory `~/.echo`. All 15,808 legacy brand references replaced.
