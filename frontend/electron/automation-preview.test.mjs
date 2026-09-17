import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { selectPreviewSource } = createRequire(import.meta.url)("./automation-preview.cjs");
const source = (id, name) => ({ id, name, thumbnail: { isEmpty: () => false } });
test("never falls back to the screen or a similarly named app", () => {
  const sources = [source("screen:0", "Desktop"), source("window:10:0", "Other - Editor")];
  assert.equal(selectPreviewSource(sources, { kind: "desktop_window", id: "missing", title: "Editor" }), null);
  assert.equal(selectPreviewSource(sources, { kind: "browser_tab", id: "10", title: "Other - Editor" }), null);
});
test("selects exact identity and rejects ambiguous title matches", () => {
  const a = source("window:10:0", "Notes"), b = source("window:12:0", "Notes");
  assert.equal(selectPreviewSource([a, b], { kind: "desktop_window", id: a.id }), a);
  assert.equal(selectPreviewSource([a, b], { kind: "desktop_window", title: "Notes" }), null);
  assert.equal(selectPreviewSource([a], { kind: "desktop_window", title: "Notes" }), a);
});
