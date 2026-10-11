import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrganization,
  getOrgDetails,
  listOrganizations,
  listChannelMembers,
  saveOrgMember,
  removeChannelMember,
} from "./api";
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer scoped-user" }),
  jsonAuthHeaders: () => ({
    Authorization: "Bearer scoped-user",
    "Content-Type": "application/json",
  }),
}));
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => value,
    });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("enterprise organization API", () => {
  it("uses the authenticated enterprise list, preserving cancellation", async () => {
    const signal = new AbortController().signal;
    const fetchMock = respond({
      organizations: [{ id: "o", name: "Company", owner_id: "u" }],
    });
    expect(await listOrganizations(signal)).toEqual([
      { id: "o", name: "Company", owner_id: "u" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs", {
      signal,
      headers: { Authorization: "Bearer scoped-user" },
    });
  });
  it.each([
    null,
    {},
    { organizations: {} },
    { organizations: [{ id: 1, name: "x", owner_id: "u" }] },
  ])(
    "rejects malformed lists without a fake empty success: %j",
    async (value) => {
      respond(value);
      await expect(listOrganizations()).rejects.toThrow(
        "Invalid organization response",
      );
    },
  );
  it("loads all three resources in the selected organization scope", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("members")
            ? {
                members: [
                  {
                    member_id: "u",
                    kind: "human",
                    role: "owner",
                    display_name: "User",
                  },
                ],
              }
            : url.endsWith("departments")
              ? { departments: [{ id: "d", name: "Dev", parent_id: null }] }
              : {
                  channels: [
                    {
                      id: "c",
                      name: "Build",
                      kind: "channel",
                      department_id: "d",
                    },
                  ],
                },
      }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getOrgDetails("org /?")).toEqual({
      members: [
        { member_id: "u", kind: "human", role: "owner", display_name: "User" },
      ],
      departments: [{ id: "d", name: "Dev", parent_id: null }],
      channels: [
        { id: "c", name: "Build", kind: "channel", department_id: "d" },
      ],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/orgs/org%20%2F%3F/members",
      "/api/orgs/org%20%2F%3F/departments",
      "/api/orgs/org%20%2F%3F/channels",
    ]);
  });
  it("creates an organization through the shared authenticated request", async () => {
    const fetchMock = respond({ id: "o", name: "Company", owner_id: "u" });
    await createOrganization("Company", "u");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Company", owner_id: "u" }),
      }),
    );
  });
  it.each([403, 409])(
    "preserves HTTP %s from membership updates",
    async (status) => {
      respond({ detail: "permission or last owner" }, status);
      await expect(
        saveOrgMember("o", {
          member_id: "u",
          kind: "human",
          role: "member",
          display_name: "User",
        }),
      ).rejects.toMatchObject({ status });
    },
  );
  it("strictly decodes channel ACL roles and encodes member IDs", async () => {
    respond({ members: [{ member_id: "u", role: "superadmin" }] });
    await expect(listChannelMembers("c")).rejects.toThrow(
      "Invalid organization response",
    );
    const fetchMock = respond({ deleted: "u /" });
    await removeChannelMember("c /", "u /");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/channels/c%20%2F/members/u%20%2F",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
