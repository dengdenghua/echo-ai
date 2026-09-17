import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./unified-diff";

describe("parseUnifiedDiff", () => {
  it("returns an empty result for missing or blank payloads", () => {
    for (const value of [null, undefined, ""]) {
      expect(parseUnifiedDiff(value)).toEqual({
        rows: [],
        added: 0,
        removed: 0,
        empty: true,
      });
    }
  });

  it("drops file-level headers that carry no reviewable content", () => {
    const { rows } = parseUnifiedDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "index 1234567..89abcde 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
      ].join("\n"),
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "hunk",
      "ctx",
      "del",
      "add",
    ]);
  });

  it("does not count the --- / +++ header as a removal or addition", () => {
    const { added, removed } = parseUnifiedDiff(
      ["--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-x", "+y"].join("\n"),
    );
    expect({ added, removed }).toEqual({ added: 1, removed: 1 });
  });

  it("numbers rows against the pre- and post-image independently", () => {
    const { rows } = parseUnifiedDiff(
      ["@@ -10,3 +20,3 @@", " ctx", "-gone", "+fresh", " tail"].join("\n"),
    );
    const body = rows.filter((row) => row.kind !== "hunk");
    expect(
      body.map((row) => [row.kind, row.oldLine, row.newLine]),
    ).toEqual([
      ["ctx", 10, 20],
      ["del", 11, undefined],
      ["add", undefined, 21],
      ["ctx", 12, 22],
    ]);
  });

  it("strips the leading marker so renderers never double it up", () => {
    const { rows } = parseUnifiedDiff(
      ["@@ -1 +1 @@", "-  indented old", "+  indented new"].join("\n"),
    );
    expect(rows[1]).toMatchObject({ kind: "del", text: "  indented old" });
    expect(rows[2]).toMatchObject({ kind: "add", text: "  indented new" });
  });

  it("ignores the no-newline marker instead of showing it as a row", () => {
    const { rows, added } = parseUnifiedDiff(
      ["@@ -1 +1 @@", "+only", "\\ No newline at end of file"].join("\n"),
    );
    expect(added).toBe(1);
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "add"]);
  });

  it("keeps a headerless whole-file body reviewable", () => {
    const { rows, empty } = parseUnifiedDiff("line one\nline two");
    expect(empty).toBe(false);
    expect(rows.map((row) => row.text)).toEqual(["line one", "line two"]);
  });

  it("trims trailing blank context that would only add height", () => {
    const { rows } = parseUnifiedDiff(
      ["@@ -1 +1 @@", "+kept", " ", " "].join("\n"),
    );
    expect(rows.at(-1)).toMatchObject({ kind: "add", text: "kept" });
  });

  it("parses multi-hunk diffs and restarts numbering per hunk", () => {
    const { rows, added, removed } = parseUnifiedDiff(
      [
        "@@ -1,2 +1,2 @@",
        "-a",
        "+b",
        "@@ -100,2 +200,2 @@",
        "-c",
        "+d",
      ].join("\n"),
    );
    expect({ added, removed }).toEqual({ added: 2, removed: 2 });
    const second = rows.slice(3);
    expect(second[1]).toMatchObject({ kind: "del", oldLine: 100 });
    expect(second[2]).toMatchObject({ kind: "add", newLine: 200 });
  });
});
