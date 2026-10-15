import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { RealtimeApprovalPrompt } from "./realtime-approval-toasts";

vi.mock("@/core/agents/project-recruitment", () => ({
  provisionProjectRoles: vi.fn(),
}));

const approval = (params: Record<string, unknown>) => ({
  requestId: 7,
  method: "item/commandExecution/requestApproval" as const,
  createdAt: "2026-10-15T00:00:00.000Z",
  params,
});

describe("<RealtimeApprovalPrompt /> summary", () => {
  it("shows a file write by name, size and first line, not raw JSON", () => {
    const path = "E:\\data\\workspaces\\t-1\\output\\final\\hello.py";
    renderWithProviders(
      <RealtimeApprovalPrompt
        approvals={[
          approval({
            tool: "write_text_file",
            argsPreview: JSON.stringify({
              content: 'from datetime import datetime\n\nprint("Hello Echo")\n',
              path,
            }),
          }),
        ]}
        resolveApproval={vi.fn()}
      />,
      { locale: "zh-CN" },
    );
    const summary = screen.getByText(
      "hello.py · 3 行 · from datetime import datetime",
    );
    expect(summary).toHaveAttribute(
      "title",
      `${path}\nfrom datetime import datetime`,
    );
    expect(screen.queryByText(/"content"/)).toBeNull();
  });

  it("shows the command and says when it runs without a sandbox", () => {
    renderWithProviders(
      <RealtimeApprovalPrompt
        approvals={[
          approval({
            tool: "exec_shell",
            argsPreview: JSON.stringify({ command: "python hello.py" }),
            unconfined: true,
          }),
        ]}
        resolveApproval={vi.fn()}
      />,
      { locale: "en-US" },
    );
    expect(screen.getByText("python hello.py")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No sandbox on this computer: approving runs it directly here",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a preview that is not JSON as it is", () => {
    renderWithProviders(
      <RealtimeApprovalPrompt
        approvals={[approval({ tool: "custom_tool", argsPreview: "{'x': 1}" })]}
        resolveApproval={vi.fn()}
      />,
      { locale: "en-US" },
    );
    expect(screen.getByText("{'x': 1}")).toBeInTheDocument();
    expect(screen.queryByText(/No sandbox/)).toBeNull();
  });
});
