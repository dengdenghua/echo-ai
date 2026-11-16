import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { FileReferenceScope } from "@/core/navigation/file-reference";
import { useChatRehypePlugins } from "@/core/rehype";
import { MarkdownContent } from "./markdown-content";
import { OPEN_ARTIFACT_EVENT } from "@/core/artifacts/open-artifact";

afterEach(() => vi.unstubAllGlobals());
vi.mock("@/core/auth/api", () => ({
  getToken: () => "qa-token",
  authHeaders: () => ({ Authorization: "Bearer qa-token" }),
}));

function Conversation({ content }: { content: string }) {
  const plugins = useChatRehypePlugins({ splitWords: false });
  return (
    <FileReferenceScope.Provider
      value={{ threadId: "t", basePath: "D:/project" }}
    >
      <MarkdownContent
        content={content}
        isLoading={false}
        rehypePlugins={plugins}
      />
    </FileReferenceScope.Provider>
  );
}

it.each([
  "[完整路径](<D:/project/报告.txt>)",
  "[完整路径](file:///D:/project/%E6%8A%A5%E5%91%8A.txt)",
])(
  "keeps local links clickable through the real Markdown and HTML sanitizers: %s",
  async (content) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "actual text" }),
    });
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(<Conversation content={content} />);
    fireEvent.click(await screen.findByRole("button", { name: "完整路径" }));
    expect(await screen.findByText("actual text")).toBeVisible();
    expect(fetch.mock.calls[0]?.[0]).toContain(
      "path=D%3A%2Fproject%2F%E6%8A%A5%E5%91%8A.txt",
    );
  },
);

it("preserves scoped output URLs through sanitization", async () => {
  const handle = vi.fn((event: Event) => event.preventDefault());
  window.addEventListener(OPEN_ARTIFACT_EVENT, handle);
  try {
    renderWithProviders(
      <Conversation content="[生成文件](workspace-output:final:report.pdf)" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "生成文件" }));
    expect(handle).toHaveBeenCalledOnce();
    expect((handle.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      path: "workspace-output:final:report.pdf",
      threadId: "t",
    });
  } finally {
    window.removeEventListener(OPEN_ARTIFACT_EVENT, handle);
  }
});

it("continues to strip executable URLs and unsafe HTML", async () => {
  const { container } = renderWithProviders(
    <Conversation
      content={
        '[unsafe](javascript:alert%281%29)\n\n<img src="x" onerror="alert(1)" /><script>alert(1)</script>'
      }
    />,
  );
  const link = await screen.findByText("unsafe");
  expect(link.closest("a")?.getAttribute("href")).toBeNull();
  expect(container.querySelector("script, [onerror]")).toBeNull();
});

it("loads Windows images through an authenticated endpoint after expanding", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["PNG"], { type: "image/png" }),
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:local-preview";
      static revokeObjectURL = vi.fn();
    },
  );
  renderWithProviders(
    <Conversation content="![渲染图](D:/project/previews/render.png)" />,
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { expanded: false }));
  expect(await screen.findByAltText("渲染图")).toHaveAttribute(
    "src",
    "blob:local-preview",
  );
  expect(fetch.mock.calls[0]?.[0]).toContain(
    "/api/fs/preview?path=D%3A%2Fproject%2Fpreviews%2Frender.png&thread_id=t",
  );
  expect(fetch.mock.calls[0]?.[1].headers).toEqual({
    Authorization: "Bearer qa-token",
  });
});
