import { describe, expect, it } from "vitest";

import { rawArtifactFrameSandbox } from "./raw-artifact-frame";

describe("rawArtifactFrameSandbox", () => {
  it.each(["report.svg", "page.xhtml", "feed.xml", "photo.PNG", "clip.mp4", "noext"])(
    "sandboxes %s with no script and an opaque origin",
    (filepath) => {
      expect(rawArtifactFrameSandbox(filepath)).toBe("");
    },
  );

  it("omits the sandbox for PDFs so the browser viewer can load", () => {
    expect(rawArtifactFrameSandbox("/mnt/user-data/outputs/Deck.PDF")).toBeUndefined();
  });
});
