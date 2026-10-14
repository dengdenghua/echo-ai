import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveToolEvent } from "./live-tool-timeline";
import { StreamingDebugger } from "./streaming-debugger";

function event(id: string, status: LiveToolEvent["status"]): LiveToolEvent {
  return {
    id,
    name: `tool-${id}`,
    status,
    startedAt: 1_000,
    iteration: 0,
  };
}

describe("<StreamingDebugger />", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("does not mount or scan event data while disabled", () => {
    let statusReads = 0;
    const trackedEvent = {
      id: "tracked",
      name: "tracked-tool",
      get status() {
        statusReads += 1;
        return "running" as const;
      },
      startedAt: 1_000,
      iteration: 0,
    } satisfies LiveToolEvent;

    const { container, rerender } = render(
      <StreamingDebugger events={[trackedEvent]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(statusReads).toBe(0);

    rerender(<StreamingDebugger events={[trackedEvent, trackedEvent]} />);

    expect(container).toBeEmptyDOMElement();
    expect(statusReads).toBe(0);
  });

  it("keeps the debugger UI and filtering available when explicitly enabled", async () => {
    window.localStorage.setItem("echo:debug:streaming", "1");
    const user = userEvent.setup();

    render(
      <StreamingDebugger
        events={[event("running", "running"), event("failed", "error")]}
      />,
    );

    await user.click(screen.getByTitle("流式调试面板 (Ctrl+Shift+D)"));

    expect(screen.getByText(/共 2 个事件/)).toBeInTheDocument();
    expect(screen.getByText("tool-running")).toBeInTheDocument();
    expect(screen.getByText("tool-failed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "错误", exact: true }));

    expect(screen.queryByText("tool-running")).not.toBeInTheDocument();
    expect(screen.getByText("tool-failed")).toBeInTheDocument();
  });

  it("toggles the panel with the Ctrl+Shift+D shortcut it advertises", async () => {
    window.localStorage.setItem("echo:debug:streaming", "1");
    const user = userEvent.setup();

    render(<StreamingDebugger events={[event("running", "running")]} />);
    expect(screen.queryByText("流式事件追踪")).toBeNull();

    await user.keyboard("{Control>}{Shift>}D{/Shift}{/Control}");
    expect(screen.getByText("流式事件追踪")).toBeInTheDocument();
    expect(screen.getByTitle("流式调试面板 (Ctrl+Shift+D)")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.keyboard("{Control>}{Shift>}D{/Shift}{/Control}");
    expect(screen.queryByText("流式事件追踪")).toBeNull();
  });

  it("ignores the shortcut while the debugger is disabled", async () => {
    const user = userEvent.setup();
    render(<StreamingDebugger events={[event("running", "running")]} />);

    await user.keyboard("{Control>}{Shift>}D{/Shift}{/Control}");

    expect(screen.queryByText("流式事件追踪")).toBeNull();
  });

  it("stays hidden in dev builds once the debug setting is turned off", () => {
    vi.stubEnv("DEV", true);
    window.localStorage.setItem("echo:debug:streaming", "0");

    const { container } = render(
      <StreamingDebugger events={[event("running", "running")]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTitle("流式调试面板 (Ctrl+Shift+D)")).toBeNull();
  });

  it("follows the settings toggle without a reload", async () => {
    const { setStreamingDebugEnabled } =
      await import("@/core/observability/streaming-debug-flag");
    render(<StreamingDebugger events={[event("running", "running")]} />);
    expect(screen.queryByTitle("流式调试面板 (Ctrl+Shift+D)")).toBeNull();

    act(() => setStreamingDebugEnabled(true));

    expect(
      screen.getByTitle("流式调试面板 (Ctrl+Shift+D)"),
    ).toBeInTheDocument();
  });
});
