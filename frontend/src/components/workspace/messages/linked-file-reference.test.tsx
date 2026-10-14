import { screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { LinkedFileReference } from "./linked-file-reference";

afterEach(() => vi.unstubAllGlobals());
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
  expect(await screen.findByRole("alert")).toHaveTextContent("403");
});
it("returns an exact file and line reference to the owning composer without sending", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
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
