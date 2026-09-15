# Design capability routing

Design uses one server-owned resolver, `runtime/core/cerebrum/design_capabilities.py`,
for the capability picker, preflight, prompt instructions and tool priority.

## Task lifecycle

1. The home screen defaults to **设计能力 · 自动**. It does not load the full plugin
   catalog, select all plugins or install anything on navigation. Opening the
   picker requests a debounced, cancellable capability preview.
2. The resolver matches a bounded set of task packs: web/UI, slides, visual
   direction, storyboards, video editing, commerce images and ComfyUI workflows.
   Manual overrides contain skill/plugin identifiers only. This is currently
   deterministic keyword matching, not another model call.
3. Submission rechecks enabled registry entries and required generation tools.
   The built-in media adapter checks whether credentials are configured. A
   selected ComfyUI bridge gets a read-only local connectivity probe. A failed
   preflight keeps the composer and attachments available for correction.
4. Preferences travel as structured `design_capabilities` context through the
   embedded conversation route and persist in turn metadata. Subsequent turns
   resolve the current goal again. Leaving Design clears the design preferences
   from turn metadata; returning to an existing design thread restores them.
5. Runtime resolution repeats enabled-state, tenant visibility and role-policy
   checks. Preferences do not grant permissions or enable plugins. Plugin IDs
   resolve to registered tool names, which participate in the actual dynamic
   tool catalog, not just a prose list. Existing tool ceilings and approvals
   still apply.

## Instructions and order

- A compact foundation contract covers layout, typography, color, accessibility,
  artifact verification and error recovery on each design turn.
- Explicitly selected skills precede task-matched skills and ordinary tools.
  Design priorities survive catalog truncation.
- Only the selected prompt skills are read from existing trusted roots through
  the shared instruction resolver, under the agent allowlist. The automatic
  selection is bounded to four prompt skills; injected content is bounded.
- Codex and OpenCode share `compose_role_instructions`. Echo's native tool loop
  and ReAct prompt assembly use the same design instruction resolver.
- Video editing selects Clip Studio; an explicit ComfyUI workflow selects its
  bridge. General design advice does not require a paid generation service.

## Verification and limits

2026-09-15 local validation:

- Frontend: 92 tests passed across composer, capability picker, design page
  contract and embedded route tests; TypeScript passed.
- Backend: 104 selected tests exercised design resolution, API preflight,
  capability ordering, Design Studio, Codex tools and OpenCode roles. The combined
  run had 103 passes and one Windows `PermissionError` in the existing concurrent
  plugin-state test; that test passed when rerun alone. Ruff passed.
- Actual preview: task matching, manual selection, refresh restoration,
  simulated failed-preflight draft retention and a 390 px mobile dialog passed.
  The packaged design frontend was rebuilt and installed through CloudCatalog.

Credential presence is not proof that a remote subscription/model is usable.
Remote providers validate authorization when called; this change does not make
paid generation calls as a health check. Live paid image/video production was
not exercised. Artifact preview/export checks are instructions to the executing
agent, not a new automatic pixel-quality scoring system. Missing optional prompt
skills are reported as a fallback to foundations; missing explicitly selected
skills/plugins and required execution tools block the task with an actionable
error.
