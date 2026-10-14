import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const view = render(<InlineVisualMessages messages={messages} />);
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
    render(
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
    expect(screen.getByText("浏览器已渲染")).toBeInTheDocument();
    send("error", "broken script");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("broken script");
    send("rendered", "");
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("查看源码"));
    expect(screen.getByText("<p>Hello</p>")).toBeInTheDocument();
  });
});
