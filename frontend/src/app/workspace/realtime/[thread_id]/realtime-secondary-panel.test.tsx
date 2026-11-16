import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RealtimeWorkbenchSurface } from "./realtime-secondary-panel";

vi.mock("@/components/workspace/agent-workbench-panel", () => ({
  AgentWorkbenchPanel: (props: {
    runSettled: boolean;
    isLoading: boolean;
    hasAnswer: boolean;
  }) => <output>{JSON.stringify(props)}</output>,
}));

it("keeps a focused live child running until its own completion receipt", () => {
  const props = {
    thread: { messages: [], values: {}, isLoading: true },
    focusedWorkbenchTurnIndex: 0,
    focusedWorkbenchAgentSnapshot: {
      id: "a",
      name: "Agent A",
      task: "Verify",
      status: "running",
    },
  } as ComponentProps<typeof RealtimeWorkbenchSurface>;
  const { rerender } = render(<RealtimeWorkbenchSurface {...props} />);
  let receipt = JSON.parse(screen.getByRole("status").textContent!);
  expect(receipt.runSettled).toBe(false);
  expect(receipt.isLoading).toBe(true);
  expect(receipt.hasAnswer).toBe(false);
  rerender(
    <RealtimeWorkbenchSurface
      {...props}
      thread={{
        ...props.thread,
        messages: [
          { id: "human", type: "human", content: "Verify" },
          {
            id: "ai",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "call",
                name: "call_agent",
                args: {
                  agent_id: "a",
                  name: "Agent A",
                  output: JSON.stringify({ success: true, output: "verified" }),
                },
              },
            ],
          },
        ],
      }}
    />,
  );
  receipt = JSON.parse(screen.getByRole("status").textContent!);
  expect(receipt.runSettled).toBe(true);
  expect(receipt.isLoading).toBe(false);
  expect(receipt.hasAnswer).toBe(true);
  expect(receipt.focusedAgentSnapshot.summary).toBe("verified");
});
