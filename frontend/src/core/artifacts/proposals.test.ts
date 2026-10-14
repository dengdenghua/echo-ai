import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createArtifactProposal,
  decideArtifactProposal,
  listArtifactProposals,
  readArtifactProposal,
} from "./proposals";
import { sha256Text } from "./save";
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8001",
}));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test" }),
}));
afterEach(() => vi.unstubAllGlobals());
const scope = {
  filepath: "workspace-output:final:site/index.html",
  threadId: "thread one",
};
describe("artifact proposal API", () => {
  it("scopes authenticated requests and sends exact base and review hashes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ proposals: [] }))),
      );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await createArtifactProposal({
      ...scope,
      signal,
      expectedContent: "<h1>Original</h1>",
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:8001/api/threads/thread%20one/output-proposals/site/index.html?area=final",
      expect.objectContaining({
        method: "POST",
        signal,
        headers: {
          Authorization: "Bearer test",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      action: "create",
      expected_sha256: await sha256Text("<h1>Original</h1>"),
    });
    await readArtifactProposal({ ...scope, proposalId: "id&escaped" });
    expect(fetchMock.mock.calls[1]![0]).toContain("proposal_id=id%26escaped");
    await decideArtifactProposal({
      ...scope,
      proposalId: "id",
      action: "accept",
      reviewedSha256: "reviewed",
    });
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({
      action: "accept",
      proposal_id: "id",
      reviewed_sha256: "reviewed",
    });
  });
  it.each([409, 503])(
    "surfaces %s without leaking raw server errors",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private server details", { status }),
          ),
      );
      const error = await listArtifactProposals(scope).catch((value) => value);
      expect(error.status).toBe(status);
      expect(error.message).not.toContain("private server details");
    },
  );
  it("rejects malformed lists and unscoped paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listArtifactProposals(scope)).rejects.toMatchObject({
      status: 502,
    });
    fetchMock.mockClear();
    await expect(
      readArtifactProposal({
        ...scope,
        filepath: "D:/private/site.html",
        proposalId: "id",
      }),
    ).rejects.toMatchObject({ status: 415 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
