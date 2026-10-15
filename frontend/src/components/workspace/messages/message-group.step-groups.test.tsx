import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AIMessage } from "@/core/api/types";
import { renderWithProviders } from "@/test/harness";

import {
  AGENT_WORKBENCH_OPEN_EVENT,
  type AgentWorkbenchOpenDetail,
} from "../agent-workbench-events";
import { MessageGroup } from "./message-group";

// Codex reports the Echo host tools it calls as ``dynamic__<tool>``; the
// realtime compat layer lifts their arguments to the top level and keeps the
// full tool name in ``command``/``tool`` when no own command exists.
const dynamicRun: AIMessage[] = [
  {
    id: "ai-dynamic",
    type: "ai",
    content: "",
    tool_calls: [
      {
        id: "ls",
        name: "dynamic__list_cwd",
        args: { path: ".", command: "dynamic__list_cwd", tool: "list_cwd" },
      },
      {
        id: "write",
        name: "dynamic__write_text_file",
        args: {
          path: "hello.py",
          content: 'print("hi")',
          command: "dynamic__write_text_file",
          tool: "write_text_file",
        },
      },
      {
        id: "run",
        name: "dynamic__run_command",
        args: { command: "python hello.py", tool: "run_command" },
        result: "hi",
      },
      {
        id: "read",
        name: "dynamic__read_file",
        args: { path: "hello.py", command: "dynamic__read_file" },
      },
    ],
  },
  { id: "ai-final", type: "ai", content: "完成。" },
];

function captureWorkbenchOpens() {
  const opened: AgentWorkbenchOpenDetail[] = [];
  const listener = (event: Event) => {
    if (event instanceof CustomEvent) opened.push(event.detail);
  };
  window.addEventListener(AGENT_WORKBENCH_OPEN_EVENT, listener);
  return {
    opened,
    stop: () =>
      window.removeEventListener(AGENT_WORKBENCH_OPEN_EVENT, listener),
  };
}

describe("MessageGroup tool-step groups", () => {
  let stopCapture: (() => void) | null = null;
  afterEach(() => {
    stopCapture?.();
    stopCapture = null;
  });

  it("toggles a mixed summary row inline instead of opening the terminal", () => {
    const capture = captureWorkbenchOpens();
    stopCapture = capture.stop;
    renderWithProviders(<MessageGroup messages={dynamicRun} />, {
      locale: "zh-CN",
    });

    const summary = screen.getByRole("button", { name: /执行了 4 个操作/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Dynamic|dynamic__/)).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(capture.opened).toHaveLength(0);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    const children = screen.getByTestId("aggregated-group-children");
    expect(children).toHaveTextContent("hello.py");
    expect(children).not.toHaveTextContent(/Dynamic|dynamic__|\\"/);

    fireEvent.click(summary);
    expect(capture.opened).toHaveLength(0);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("expands a single shell step in place instead of opening a terminal", () => {
    const capture = captureWorkbenchOpens();
    stopCapture = capture.stop;
    renderWithProviders(<MessageGroup messages={dynamicRun} />, {
      locale: "zh-CN",
    });

    fireEvent.click(screen.getByRole("button", { name: /执行了 4 个操作/ }));
    const children = screen.getByTestId("aggregated-group-children");
    const shellRow = within(children)
      .getAllByTestId("process-timeline-event-execution")
      .find((row) => row.getAttribute("data-process-event-id") === "run");
    expect(shellRow).toBeDefined();
    const openedBefore = capture.opened.length;
    fireEvent.click(shellRow!);

    // The conversation page shows no trace view, so the command expands here.
    expect(screen.getByTestId("process-step-detail")).toHaveTextContent(
      "$ python hello.py",
    );
    expect(capture.opened).toHaveLength(openedBefore);
    expect(capture.opened.some((detail) => detail.tab === "terminal")).toBe(
      false,
    );
  });

  it("draws no connector line when every nested step is hidden", () => {
    // Steps owned by two different sub-agents form one visible group at the
    // top level, but each nested row is suppressed with its sub-agent.
    const callOf = (parent: string, id: string, agentName: string) => ({
      id,
      name: "call_agent",
      args: { agent_name: agentName },
      parentItemId: parent,
    });
    const childOf = (parent: string, id: string, path: string) => ({
      id,
      name: "read_file",
      args: { path },
      parentItemId: parent,
    });
    const messages: AIMessage[] = [
      {
        id: "ai-team",
        type: "ai",
        content: "",
        tool_calls: [
          callOf("lane-a", "call-a", "Alpha"),
          callOf("lane-b", "call-b", "Beta"),
          childOf("lane-a", "read-a1", "a1.ts"),
          childOf("lane-b", "read-b1", "b1.ts"),
          childOf("lane-a", "read-a2", "a2.ts"),
          childOf("lane-b", "read-b2", "b2.ts"),
        ],
      },
      { id: "ai-final", type: "ai", content: "完成。" },
    ];
    const capture = captureWorkbenchOpens();
    stopCapture = capture.stop;

    renderWithProviders(
      <MessageGroup messages={messages} suppressSubagentRows />,
      { locale: "zh-CN" },
    );

    const summary = screen.getByRole("button", { name: /执行了 6 个操作/ });
    expect(summary).not.toHaveAttribute("aria-expanded");
    expect(
      screen.queryByTestId("aggregated-group-toggle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("aggregated-group-children"),
    ).not.toBeInTheDocument();
    // Nothing can expand inline, so the row keeps opening its evidence.
    fireEvent.click(summary);
    expect(
      screen.queryByTestId("aggregated-group-children"),
    ).not.toBeInTheDocument();
    expect(capture.opened).toHaveLength(1);
  });
});
