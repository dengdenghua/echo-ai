import { describe, expect, it } from "vitest";

import { LIVE_PREVIEW_SANDBOX, normalizePreviewUrl } from "./browser-preview-url";

const APP = ["http://localhost:3310", "http://127.0.0.1:8310"];

describe("normalizePreviewUrl", () => {
  it("keeps external http(s) and third-party loopback dev servers", () => {
    expect(normalizePreviewUrl("https://example.com/a", APP)).toBe("https://example.com/a");
    expect(normalizePreviewUrl("localhost:5173/app", APP)).toBe("http://localhost:5173/app");
  });

  it("rejects non-http schemes", () => {
    expect(normalizePreviewUrl("javascript:alert(1)", APP)).toBe("");
    expect(normalizePreviewUrl("data:text/html,<script>1</script>", APP)).toBe("");
    expect(normalizePreviewUrl("file:///etc/passwd", APP)).toBe("");
  });

  it("refuses to embed the app or backend origin, including loopback aliases", () => {
    expect(normalizePreviewUrl("http://localhost:3310/workspace", APP)).toBe("");
    expect(
      normalizePreviewUrl("http://127.0.0.1:8310/api/threads/t/artifacts/x.svg", APP),
    ).toBe("");
    expect(normalizePreviewUrl("localhost:8310/api/deployments/x", APP)).toBe("");
    expect(normalizePreviewUrl("http://0.0.0.0:3310/", APP)).toBe("");
  });

  it("defaults to protecting the current window origin", () => {
    expect(normalizePreviewUrl(`${window.location.origin}/x`)).toBe("");
  });
});

describe("LIVE_PREVIEW_SANDBOX", () => {
  it("never grants allow-same-origin", () => {
    expect(LIVE_PREVIEW_SANDBOX.split(" ")).not.toContain("allow-same-origin");
    expect(LIVE_PREVIEW_SANDBOX.split(" ")).toContain("allow-scripts");
  });
});
