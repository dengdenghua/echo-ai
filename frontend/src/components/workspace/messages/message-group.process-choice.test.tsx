import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AIMessage } from "@/core/api/types";
import { renderWithProviders } from "@/test/harness";
import { ThreadMetaContext } from "./context";
import { MessageGroup } from "./message-group";

function renderedText(text: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === text &&
    !Array.from(element.children).some((child) => child.textContent === text);
}

// jsdom has no matchMedia. Reduced motion reveals full text immediately.
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

vi.mock("../artifacts", () => ({
  useArtifacts: () => ({
    setOpen: vi.fn(),
    autoOpen: false,
    autoSelect: false,
    selectedArtifact: null,
    select: vi.fn(),
  }),
}));

describe("MessageGroup process choice persistence", () => {
  it("restores a live process choice after remount and isolates it from another chat", () => {
    const trace: AIMessage = {
      id: "shared-tool-id",
      type: "ai",
      content: "",
      tool_calls: [{ id: "read", name: "read_file", args: { path: "report.md" } }],
    };
    const tree = (threadId: string) => (
      <ThreadMetaContext.Provider value={{ threadId }}>
        <MessageGroup messages={[trace]} isLoading collapseCompletedProcess />
      </ThreadMetaContext.Provider>
    );
    const first = renderWithProviders(tree("a"));
    fireEvent.click(screen.getByTestId("process-replay-toggle"));
    expect(screen.getByTestId("process-replay-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    first.unmount();
    const restored = renderWithProviders(tree("a"));
    expect(screen.getByTestId("process-replay-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    restored.unmount();
    renderWithProviders(tree("b"));
    expect(screen.getByTestId("process-replay-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps tool-backed streaming text visible when process details are folded", () => {
    renderWithProviders(
      <MessageGroup
        messages={[
          {
            id: "streaming-with-tool",
            type: "ai",
            content: "正在收束结论",
            tool_calls: [
              { id: "read", name: "read_file", args: { path: "report.md" } },
            ],
          },
        ]}
        isLoading
        collapseCompletedProcess
      />,
    );
    fireEvent.click(screen.getByTestId("process-replay-toggle"));
    expect(screen.getByText(renderedText("正在收束结论"))).toBeInTheDocument();
    expect(
      screen.queryByTestId("process-timeline-event-execution"),
    ).not.toBeInTheDocument();
  });

  it("preserves manual folding through streamed steps, completion and reconnection", () => {
    const trace: AIMessage = {
      id: "live-tools",
      type: "ai",
      content: "",
      tool_calls: [
        { id: "read-one", name: "read_file", args: { path: "one.md" } },
      ],
    };
    const { rerender } = renderWithProviders(
      <MessageGroup messages={[trace]} isLoading collapseCompletedProcess />,
    );
    const toggle = () => screen.getByTestId("process-replay-toggle");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    const moreSteps: AIMessage = {
      ...trace,
      tool_calls: Array.from({ length: 10 }, (_, i) => ({
        id: `read-${i}`,
        name: "read_file",
        args: { path: `${i}.md` },
      })),
    };
    rerender(
      <MessageGroup
        messages={[moreSteps]}
        isLoading
        collapseCompletedProcess
      />,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    rerender(<MessageGroup messages={[moreSteps]} collapseCompletedProcess />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    rerender(
      <MessageGroup messages={[trace]} isLoading collapseCompletedProcess />,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle());
    rerender(<MessageGroup messages={[moreSteps]} collapseCompletedProcess />);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    rerender(
      <MessageGroup
        key="new-run"
        messages={[{ ...trace, id: "retry-tools" }]}
        isLoading
        collapseCompletedProcess
      />,
    );
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });
});
