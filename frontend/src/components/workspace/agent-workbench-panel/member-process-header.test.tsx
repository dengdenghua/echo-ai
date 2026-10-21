import { act, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import type { LiveToolEvent } from "../live-tool-timeline";
import { deriveAgentTilesFromEvents } from "../use-agent-workbench-i18n";
import { MemberProcessHeader } from "./member-process-header";

afterEach(() => vi.useRealTimers());

it("keeps the member clock running across child results and stops only at lifecycle completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const spawned: LiveToolEvent = {
    id: "spawn", name: "subagent", lifecycle: "spawned", status: "running",
    agentId: "task-1", subAgentRole: "coder", subagentCodename: "Spark-abc", startedAt: 1000, iteration: 0,
  };
  const child: LiveToolEvent = {
    id: "read", name: "read_file", status: "done", agentId: "task-1",
    startedAt: 2000, finishedAt: 3000, durationMs: 1000, iteration: 0,
  };
  function header(events: LiveToolEvent[]) {
    const [agent] = deriveAgentTilesFromEvents(events);
    if (!agent) throw new Error("Missing member");
    return <MemberProcessHeader agent={agent} onOpenMain={vi.fn()} />;
  }
  const view = renderWithProviders(header([spawned]));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:09");
  view.rerender(header([spawned, child]));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:09");
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:14");

  const finished: LiveToolEvent = { ...spawned, id: "finish", lifecycle: "finished", status: "done", startedAt: 15000, finishedAt: 15000, durationMs: 14000 };
  const lateChild: LiveToolEvent = { ...child, id: "late-child", startedAt: 16000, finishedAt: 17000, durationMs: 1000 };
  view.rerender(header([spawned, child, finished, lateChild]));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:14");
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByLabelText("Elapsed time")).toHaveTextContent("0:14");
});
