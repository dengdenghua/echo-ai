export const auditActions = ['audit-start', 'audit-status', 'audit-capture', 'audit-read', 'audit-import', 'audit-action', 'audit-coverage', 'audit-finding', 'audit-report'];
export function auditDefinitions(z) {
  const absolute = z.string().min(1).describe('Absolute local path');
  const audit = { audit: absolute.describe('Audit directory returned by start_android_walkthrough') };
  const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
  const text = z.string().min(1).max(4000);
  const strings = z.array(z.string().max(2000)).max(30).default([]);
  const snapshots = z.array(z.string()).max(30).default([]);
  return [
    ['audit-start', 'start_android_walkthrough', 'Create/resume a visual/UX ledger bound to an explicit package and optional device and unpacking workspace. Does not launch/install apps.', {
      ...audit, package: z.string().min(3).max(200), serial: z.string().min(1).max(200).optional(), workspace: absolute.optional(), title: z.string().min(1).max(200).default('视觉与 UX 走查'),
    }],
    ['audit-status', 'android_walkthrough_status', 'Read snapshots, interaction history, coverage and findings. Untouched states remain unreviewed.', audit],
    ['audit-capture', 'capture_android_walkthrough', 'Capture a real device PNG, UI hierarchy, foreground, display/density/keyboard context and app version. Returns image and bounded nodes with IDs. Missing hierarchy and possible temporal drift are explicit. Geometry candidates are not confirmed bugs.', {
      ...audit, label: z.string().min(1).max(200), node_offset: z.number().int().min(0).default(0), node_limit: z.number().int().min(1).max(100).default(60),
    }],
    ['audit-import', 'import_walkthrough_screenshot', 'Copy a supplied PNG with hashes and provenance into a visual/UX ledger. Imported screenshots cannot authorize device actions; useful for other platforms too.', {
      ...audit, path: absolute, label: z.string().min(1).max(200), provenance: z.string().min(1).max(2000),
    }],
    ['audit-read', 'read_walkthrough_snapshot', 'Read/hash-check a saved screenshot and page its UI node inventory without recapturing. Returns real image. Saved snapshots do not establish current UI state.', {
      ...audit, snapshot_id: z.string().min(1), node_offset: z.number().int().min(0).default(0), node_limit: z.number().int().min(1).max(100).default(60),
    }],
    ['audit-action', 'perform_android_walkthrough_action', 'Record ONE tap on an observed clickable node, swipe, or back and capture result. Requires fresh matching foreground/hierarchy. User authorization governs login, sends, purchases and destructive controls. Expected result is never automatically marked passed.', {
      ...audit, snapshot_id: z.string().min(1), action: z.enum(['tap', 'swipe', 'back']), node_id: z.string().optional(), points: z.array(z.number().int().min(0)).length(4).optional(), expected: text, label: z.string().min(1).max(200),
    }],
    ['audit-coverage', 'record_walkthrough_coverage', 'Record a visual state or UX flow as observed, blocked or unreviewed, with screenshots, reproduction and actual outcome. Loading/empty/error/back/recovery/keyboard are separate coverage items.', {
      ...audit, id, area: z.enum(['visual', 'ux']), goal: text, status: z.enum(['observed', 'blocked', 'unreviewed']), snapshot_ids: snapshots, steps: strings, actual: z.string().max(4000).default(''), limitation: z.string().max(4000).default(''),
    }],
    ['audit-finding', 'record_walkthrough_finding', 'Record visual/UX issue with screenshot evidence, optional pixel rectangles, priority, reproduction, expected/actual and fix suggestion. Optional deep evidence links unpacked code. Validates hashes; HTML overlays leave originals intact.', {
      ...audit, id, area: z.enum(['visual', 'ux']), title: text, priority: z.enum(['P0', 'P1', 'P2', 'P3']), evidence_type: z.enum(['runtime_observation', 'inference']), snapshot_ids: z.array(z.string()).min(1).max(20),
      boxes: z.array(z.object({ snapshot_id: z.string(), rect: z.array(z.number().int().min(0)).length(4), label: z.string().max(200) })).max(30).default([]), steps: strings, expected: text, actual: text, suggestion: text, limitations: strings, deep_evidence_ids: z.array(z.string()).max(20).default([]),
    }],
    ['audit-report', 'export_walkthrough_report', 'Export self-contained HTML and Markdown with real screenshot annotations, priority/repro steps, coverage gaps and action history; optional static findings. Excludes changed/missing evidence. No invented issues from geometry candidates.', {
      ...audit, title: z.string().min(1).max(200).default('视觉、UX 与解包逆向走查报告'),
    }],
  ];
}
