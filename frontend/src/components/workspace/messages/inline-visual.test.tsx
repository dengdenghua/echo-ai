import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import {
  buildVisualDocument,
  InlineVisual,
  InlineVisualMessages,
  parseVisualReceipt,
} from "./inline-visual";
import type { Message } from "@/core/api/types";

vi.mock("@/core/auth/api", () => ({
  jsonAuthHeaders: () => ({ "Content-Type": "application/json" }),
}));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost",
}));
const receipt = {
  ok: true,
  kind: "echo.visual.v1" as const,
  visual_id: "example",
  receipt_token: "secret-token",
  thread_id: "task",
};
afterEach(() => vi.unstubAllGlobals());

describe("inline visuals", () => {
  it("only runs model scripts in complete HTML, never partial output or SVG", () => {
    const code =
      '<p onclick="alert(1)">Hi</p><script>window.example=1</script><iframe src="https://evil.test"></iframe>';
    expect(
      buildVisualDocument(code, "html", "test-channel", false),
    ).not.toContain("window.example=1");
    expect(
      buildVisualDocument(code, "svg", "test-channel", true),
    ).not.toContain("window.example=1");
    const html = buildVisualDocument(code, "html", "test-channel", true);
    expect(html).toContain("window.example=1");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("secret-token");
  });

  it("parses real execution prefixes but rejects unrelated or failed results", () => {
    expect(
      parseVisualReceipt(
        `(real tool execution succeeded) show_visual\n${JSON.stringify(receipt)}`,
      ),
    ).toMatchObject(receipt);
    expect(parseVisualReceipt({ ...receipt, ok: false })).toBeNull();
    expect(parseVisualReceipt("partial")).toBeNull();
  });

  it("renders successful persisted tool calls and excludes rejected ones", () => {
    const messages = [
      {
        id: "ai",
        type: "ai",
        content: "",
        tool_calls: [
          {
            id: "call",
            name: "show_visual",
            args: { title: "Example", format: "html", code: "<p>Hello</p>" },
          },
        ],
      },
      {
        id: "tool",
        type: "tool",
        tool_call_id: "call",
        content: JSON.stringify(receipt),
      },
    ] as Message[];
    const view = renderWithProviders(
      <InlineVisualMessages messages={messages} />,
    );
    expect(screen.getByTitle("Example")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    view.rerender(
      <InlineVisualMessages
        messages={[
          messages[0]!,
          { ...messages[1]!, content: '{"ok":false}' } as Message,
        ]}
      />,
    );
    expect(screen.queryByTestId("inline-visual")).not.toBeInTheDocument();
  });

  it("ignores forged frame messages, reports paint then late errors, clamps height", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetcher);
    renderWithProviders(
      <InlineVisual
        title="Example"
        code="<p>Hello</p>"
        format="html"
        complete
        receipt={receipt}
      />,
    );
    const frame = screen.getByTitle("Example") as HTMLIFrameElement;
    const channel = /channel: "([^"]+)"/.exec(frame.srcdoc)![1];
    const send = (
      type: string,
      detail: unknown,
      source: Window | null = frame.contentWindow,
    ) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source,
            data: { channel, type, detail },
          }),
        );
      });
    send("rendered", "", window);
    expect(fetcher).not.toHaveBeenCalled();
    send("resize", 99999);
    expect(frame.style.height).toBe("1200px");
    send("rendered", "");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Rendered in browser")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request a fix" }),
    ).not.toBeInTheDocument();
    send("error", "broken script");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("broken script");
    expect(screen.getByText("Render error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request a fix" }),
    ).toBeInTheDocument();
    send("rendered", "");
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("View source"));
    expect(screen.getByText("<p>Hello</p>")).toBeInTheDocument();
  });

  it("follows the UI language for status and the fix request", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const sent: string[] = [];
    const quickReply = (event: Event) => {
      event.preventDefault();
      sent.push(String((event as CustomEvent<{ text: unknown }>).detail.text));
    };
    window.addEventListener("echo:quick-reply", quickReply);
    renderWithProviders(
      <InlineVisual
        title="示例"
        code="<p>Hello</p>"
        format="html"
        complete
        receipt={receipt}
      />,
      { locale: "zh-CN" },
    );
    const frame = screen.getByTitle("示例") as HTMLIFrameElement;
    const channel = /channel: "([^"]+)"/.exec(frame.srcdoc)![1];
    expect(screen.getByText("等待浏览器渲染")).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { channel, type: "error", detail: "broken script" },
        }),
      );
    });
    expect(screen.getByText("渲染出错")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "请求修复" }));
    window.removeEventListener("echo:quick-reply", quickReply);
    expect(sent).toEqual([
      "请修复可视化 example（示例）。浏览器报错：broken script。修正后重新 show_visual。",
    ]);
    expect(screen.getByText("已提交到当前任务")).toBeInTheDocument();
  });
});
