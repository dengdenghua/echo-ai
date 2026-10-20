import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadPromptInputFiles } from "./use-thread-stream-realtime";

afterEach(() => vi.unstubAllGlobals());

// ── attach-time uploads are not re-posted at send ─
//
// The composer now uploads the moment a file lands in it. Sending used to
// upload unconditionally, which would push the same bytes twice and mint a
// second artifact for one picture.
describe("uploadPromptInputFiles", () => {
  const file = new File(["img"], "shot.png", { type: "image/png" });
  const uploaded = {
    filename: "shot.png",
    size: file.size,
    path: "/artifacts/shot.png",
    virtual_path: "uploads/shot.png",
    artifact_url: "https://example.test/shot.png",
    content_type: "image/png",
  };

  it("skips the network when every part carries server-side info", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const attachments = await uploadPromptInputFiles("thread-1", [
      {
        type: "file",
        mediaType: "image/png",
        filename: "shot.png",
        url: "data:image/png;base64,aW1n",
        file,
        uploaded,
      },
    ]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(attachments[0]).toMatchObject({
      filename: "shot.png",
      artifact_url: "https://example.test/shot.png",
    });
  });

  it("still uploads when a part has no attach-time info", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, files: [uploaded] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    await uploadPromptInputFiles("thread-1", [
      {
        type: "file",
        mediaType: "image/png",
        filename: "shot.png",
        url: "data:image/png;base64,aW1n",
        file,
      },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
