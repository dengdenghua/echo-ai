/**
 * Unified-diff parsing for review surfaces.
 *
 * Kept as a pure module (no React, no DOM) so the row/counter semantics can be
 * asserted directly in tests. Renderers stay dumb and just map rows to markup.
 */

export type DiffRowKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffRow {
  kind: DiffRowKind;
  /** Row content with the leading +/-/space marker already stripped. */
  text: string;
  /** 1-based line number in the pre-image, when the row exists there. */
  oldLine?: number;
  /** 1-based line number in the post-image, when the row exists there. */
  newLine?: number;
}

export interface ParsedDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** True when the payload carried no recognizable hunk. */
  empty: boolean;
}

const HUNK_RE = /^@@+\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * File-level preamble emitted by git and most MCP write tools. These lines
 * carry no reviewable content, and showing them costs the reader a scan for
 * every single file, so they are dropped rather than rendered as context.
 */
function isDroppedHeader(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("Binary files ")
  );
}

export function parseUnifiedDiff(diff: string | null | undefined): ParsedDiff {
  if (typeof diff !== "string" || diff.length === 0) {
    return { rows: [], added: 0, removed: 0, empty: true };
  }

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let sawHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split(/\r?\n/)) {
    // "\ No newline at end of file" is a note about the previous row, not a
    // reviewable line of its own.
    if (raw.startsWith("\\")) continue;
    if (isDroppedHeader(raw)) continue;

    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      sawHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      rows.push({ kind: "hunk", text: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      added += 1;
      rows.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
      continue;
    }
    if (raw.startsWith("-")) {
      removed += 1;
      rows.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
      continue;
    }

    // Some tools emit bare content lines for whole-file writes, with no hunk
    // header and no markers. Treat them as context so the body is still
    // reviewable instead of silently rendering nothing.
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (!sawHunk && text.length === 0) continue;
    rows.push({
      kind: sawHunk ? "ctx" : "meta",
      text,
      oldLine: oldLine++,
      newLine: newLine++,
    });
  }

  // Trailing blank context adds height without information.
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if ((last.kind === "ctx" || last.kind === "meta") && last.text === "") {
      rows.pop();
      continue;
    }
    break;
  }

  return { rows, added, removed, empty: rows.length === 0 };
}
