import { screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { OPEN_ARTIFACT_EVENT } from "@/core/artifacts/open-artifact";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { LinkedFileReference } from "./linked-file-reference";
import { parseFilePreviewRef } from "@/core/artifacts/file-preview-ref";

const conversation = vi.hoisted(() => ({ artifacts: [] as string[] }));
vi.mock("@/components/workspace/artifacts/context", () => ({
  useOptionalArtifacts: () => ({ artifacts: conversation.artifacts }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  conversation.artifacts = [];
});

function listenForArtifactOpens() {
  const opened: string[] = [];
  const handle = (event: Event) => {
    event.preventDefault();
    opened.push((event as CustomEvent<{ path: string }>).detail.path);
  };
  window.addEventListener(OPEN_ARTIFACT_EVENT, handle);
  return {
    opened,
    stop: () => window.removeEventListener(OPEN_ARTIFACT_EVENT, handle),
  };
}

it("routes ordinary file citations to the same workbench and preserves scope and lines", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const listener = listenForArtifactOpens();
  renderWithProviders(<FileReferenceScope.Provider value={{ threadId: "t1", basePath: "D:/project" }}><LinkedFileReference path="src/a.ts" lines="2-4" /></FileReferenceScope.Provider>);
  fireEvent.click(screen.getByRole("button", { name: /a.ts/ }));
  listener.stop();
  expect(parseFilePreviewRef(listener.opened[0]!)).toEqual({ path: "src/a.ts", lines: "2-4", threadId: "t1", basePath: "D:/project" });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("renders the shared file reader inside the panel without a second dialog", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: "one\ntwo" }) }));
  renderWithProviders(<FileReferenceScope.Provider value={{ threadId: "t1" }}><LinkedFileReference path="a.ts" lines="2" embedded /></FileReferenceScope.Provider>);
  expect(await screen.findByText("two")).toHaveClass("bg-primary/10");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Reference this file" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reference this file" }));
  expect(screen.getByText("two")).toBeInTheDocument();
});

it("opens a file the run produced in the artifacts tab instead of reading the workspace", () => {
  conversation.artifacts = [
    "workspace-output:final:README.md",
    "workspace-output:final:hello.py",
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const listener = listenForArtifactOpens();
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "t1", basePath: "D:/personal" }}
    >
      <LinkedFileReference path="hello.py" />
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /hello\.py/ }));
  listener.stop();
  expect(listener.opened).toEqual(["workspace-output:final:hello.py"]);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers the same-named artifact when the workspace read is refused", async () => {
  conversation.artifacts = ["workspace-output:final:hello.py"];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  const listener = listenForArtifactOpens();
  renderWithProviders(<LinkedFileReference path="src/hello.py" />);
  fireEvent.click(screen.getByRole("button", { name: /hello\.py/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "authorized workspace",
  );
  fireEvent.click(screen.getByRole("button", { name: "Open in Artifacts" }));
  listener.stop();
  expect(listener.opened).toEqual(["workspace-output:final:hello.py"]);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("opens a scoped file and highlights the cited line", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: "first\nselected\nlast" }),
  });
  vi.stubGlobal("fetch", fetch);
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "t1", basePath: "D:/project" }}
    >
      <LinkedFileReference path="src/a.ts" lines="2" />
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /a.ts/ }));
  expect(await screen.findByText("selected")).toHaveClass("bg-primary/10");
  await waitFor(() =>
    expect(fetch.mock.calls[0]?.[0]).toContain("thread_id=t1"),
  );
  expect(fetch.mock.calls[0]?.[0]).toContain(
    "path=D%3A%2Fproject%2Fsrc%2Fa.ts",
  );
});
it("shows a read failure instead of silently doing nothing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  renderWithProviders(<LinkedFileReference path="private.txt" />);
  fireEvent.click(screen.getByRole("button", { name: "private.txt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "authorized workspace",
  );
});

it("preserves a shortened reference and shows the actual resolved path", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: "actual evidence",
      path: "D:/project/design/evidence/probe.log",
    }),
  });
  vi.stubGlobal("fetch", fetch);
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "t", basePath: "D:/project" }}
    >
      <LinkedFileReference path="probe.log" />
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "probe.log" }));
  await screen.findByText("actual evidence");
  expect(fetch.mock.calls[0]?.[0]).toContain("reference=probe.log");
  expect(
    screen.getByText("D:/project/design/evidence/probe.log"),
  ).toBeVisible();
});

it("lets the user select an ambiguous full path, then reads that exact file", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        detail: {
          candidates: ["D:/project/a/model.txt", "D:/project/b/model.txt"],
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: "chosen model" }),
    });
  vi.stubGlobal("fetch", fetch);
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "t", basePath: "D:/project" }}
    >
      <LinkedFileReference path="model.txt" />
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "model.txt" }));
  await screen.findByRole("alert");
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "D:/project/b/model.txt" }),
  );
  await screen.findByText("chosen model");
  expect(fetch.mock.calls[1]?.[0]).toContain(
    "path=D%3A%2Fproject%2Fb%2Fmodel.txt",
  );
  expect(fetch.mock.calls[1]?.[0]).not.toContain("reference=");
});

it("can retry a file that was not yet written without reopening the conversation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 404 })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: "now available" }),
    });
  vi.stubGlobal("fetch", fetch);
  renderWithProviders(<LinkedFileReference path="report.txt" />);
  fireEvent.click(screen.getByRole("button", { name: "report.txt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("now available");
});
it("returns an exact file and line reference to the owning composer without sending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "line one\nline two" }),
    }),
  );
  const received = vi.fn();
  window.addEventListener("echo:quote-message", received);
  renderWithProviders(
    <FileReferenceScope.Provider
      value={{ threadId: "owner", basePath: "D:/project" }}
    >
      <LinkedFileReference path="src/a.ts" lines="2" />
    </FileReferenceScope.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /a.ts/ }));
  await screen.findByText("line two");
  fireEvent.click(screen.getByRole("button", { name: "Reference this file" }));
  expect(received).toHaveBeenCalledOnce();
  expect((received.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
    threadId: "owner",
    text: expect.stringContaining("D:/project/src/a.ts:2"),
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  window.removeEventListener("echo:quote-message", received);
});
