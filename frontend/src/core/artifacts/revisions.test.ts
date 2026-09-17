import { afterEach, describe, expect, it, vi } from "vitest";
import { listArtifactRevisions, readArtifactRevision } from "./revisions";
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8001",
}));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test" }),
}));
afterEach(() => vi.unstubAllGlobals());
const request = {
  filepath: "workspace-output:final:site/index.html",
  threadId: "thread one",
};

describe("artifact revision requests", () => {
  it("scopes authenticated history and revision reads with cancellation", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ revisions: [], next_cursor: null })),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await listArtifactRevisions({
      ...request,
      before: "older",
      signal: controller.signal,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8001/api/threads/thread%20one/output-revisions/site/index.html?area=final&before=older",
      expect.objectContaining({
        headers: { Authorization: "Bearer test" },
        signal: controller.signal,
      }),
    );
    await readArtifactRevision({ ...request, revisionId: "version&escaped" });
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "revision_id=version%26escaped",
    );
  });
  it("does not turn failed history requests into empty success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("private details", { status: 503 })),
    );
    await expect(listArtifactRevisions(request)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("rejects unscoped paths without sending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listArtifactRevisions({ ...request, filepath: "D:/private/site.html" }),
    ).rejects.toMatchObject({ status: 415 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
