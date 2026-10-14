import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer session" }),
  jsonAuthHeaders: () => ({
    Authorization: "Bearer session",
    "Content-Type": "application/json",
  }),
}));

import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  checkHealth,
  getWorkspaceExecutionDirectory,
} from "./api";

beforeEach(() => {
  vi.restoreAllMocks();
});

it("lets the backend derive the workspace actor from the authenticated session", async () => {
  const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ workspaces: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await expect(listWorkspaces()).resolves.toEqual([]);
  expect(fetchSpy).toHaveBeenCalledWith("/api/workspaces", {
    headers: { Authorization: "Bearer session" },
  });
});

it("unwraps workspace responses and maps the backend health result", async () => {
  const workspace = {
    id: "shared",
    name: "Shared",
    mount_type: "local" as const,
    mount_target: "/mnt/team",
    mount_options: {},
    owner_id: "alice",
    created_at: "0",
  };
  const fetcher = vi.spyOn(window, "fetch");
  fetcher.mockResolvedValue(new Response(JSON.stringify({ workspace })));
  await expect(getWorkspace("shared")).resolves.toEqual(workspace);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ workspace })));
  await expect(createWorkspace(workspace)).resolves.toEqual(workspace);
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, workspace_id: "shared" })),
  );
  await expect(checkHealth("shared")).resolves.toMatchObject({ healthy: true });
});

it("only returns an execution directory confirmed by the connected backend", async () => {
  const fetcher = vi
    .spyOn(window, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ ready: true, filesystem_path: "/mnt/team" }),
      ),
    );
  await expect(getWorkspaceExecutionDirectory("shared")).resolves.toBe(
    "/mnt/team",
  );
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        ready: false,
        filesystem_path: null,
        detail: "mount required",
      }),
    ),
  );
  await expect(getWorkspaceExecutionDirectory("shared")).rejects.toThrow(
    "mount required",
  );
});
