import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { FileTree } from "./file-tree";

const mocks = vi.hoisted(() => ({
  thread: vi.fn(),
  fetch: vi.fn(),
  removed: vi.fn(),
  subscribe: vi.fn<(id: string, update: () => void) => () => void>(),
}));
vi.mock("@/core/api", () => ({
  getAPIClient: () => ({ threads: { get: mocks.thread } }),
}));
vi.mock("./workspace-file-updates-api", () => ({
  subscribeWorkspaceFileUpdates: mocks.subscribe,
}));
vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.subscribe.mockReturnValue(mocks.removed);
  mocks.thread.mockResolvedValue({ metadata: { workspace_id: "shared" } });
  mocks.fetch.mockImplementation((url: string) =>
    Promise.resolve(
      Response.json(url.includes("/fs/tree") ? { entries: [] } : { files: [] }),
    ),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("an authorized thread binding connects the actual file tree and bypasses its cache on a hint", async () => {
  const view = renderWithProviders(
    <FileTree threadId="owned-thread" workDir="/workspaces/tree-hint" />,
  );
  await waitFor(() =>
    expect(mocks.subscribe).toHaveBeenCalledWith(
      "shared",
      expect.any(Function),
    ),
  );
  expect(mocks.thread).toHaveBeenCalledWith("owned-thread");
  await waitFor(() =>
    expect(
      mocks.fetch.mock.calls.filter(([url]) => url.includes("/fs/tree")),
    ).toHaveLength(1),
  );
  mocks.fetch.mockImplementation((url: string) =>
    Promise.resolve(
      Response.json(
        url.includes("/fs/tree")
          ? {
              entries: [
                {
                  name: "result.txt",
                  path: "result.txt",
                  type: "file",
                  depth: 1,
                },
              ],
            }
          : { files: [] },
      ),
    ),
  );
  await act(async () => mocks.subscribe.mock.calls[0]![1]());
  expect(await screen.findByText("result.txt")).toBeInTheDocument();
  expect(
    mocks.fetch.mock.calls.filter(([url]) => url.includes("/fs/tree")),
  ).toHaveLength(2);
  view.unmount();
  expect(mocks.removed).toHaveBeenCalledOnce();
});

it("a late binding from a disposed tree cannot open a workspace socket", async () => {
  let resolve!: (value: unknown) => void;
  mocks.thread.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = renderWithProviders(
    <FileTree threadId="old-thread" workDir="/workspaces/tree-disposed" />,
  );
  view.unmount();
  await act(async () =>
    resolve({ metadata: { workspace_id: "old-private-workspace" } }),
  );
  expect(mocks.subscribe).not.toHaveBeenCalled();
});

it("remote prefixes subscribe directly while local drive letters do not become workspace ids", async () => {
  const remote = renderWithProviders(<FileTree workDir="shared:/src" />);
  await waitFor(() =>
    expect(mocks.subscribe).toHaveBeenCalledWith(
      "shared",
      expect.any(Function),
    ),
  );
  expect(mocks.thread).not.toHaveBeenCalled();
  remote.unmount();
  mocks.subscribe.mockClear();
  const local = renderWithProviders(
    <FileTree workDir="C:/workspace/project" />,
  );
  await act(async () => {});
  expect(mocks.subscribe).not.toHaveBeenCalled();
  local.unmount();
});
