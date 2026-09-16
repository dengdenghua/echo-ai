import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import {
  fetchRoleRegistration,
  type RoleRegistrationCheck,
} from "@/core/agents/readiness";
import { RoleReadiness } from "./role-readiness";

vi.mock("@/core/agents/readiness", () => ({ fetchRoleRegistration: vi.fn() }));
const fetchCheck = vi.mocked(fetchRoleRegistration);
const checked: RoleRegistrationCheck = {
  agent_id: "demo",
  scope: "configured_skill_registration",
  status: "checked",
  checks: [{ name: "call_agent", status: "registered" }],
  unchecked: ["execution"],
};

describe("role readiness", () => {
  beforeEach(() => fetchCheck.mockReset());

  it("rechecks after repair and opens the existing skill manager", async () => {
    fetchCheck
      .mockResolvedValueOnce({
        ...checked,
        status: "needs_attention",
        checks: [{ name: "call_agent", status: "missing" }],
      })
      .mockResolvedValueOnce(checked);
    const configure = vi.fn();
    renderWithProviders(
      <RoleReadiness agentId="demo" onConfigure={configure} />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByText("Some skills need attention"));
    expect(screen.getByText("Not registered")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Manage skills" }));
    expect(configure).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(
      await screen.findByText("Configured skills are registered"),
    ).toBeVisible();
    expect(screen.queryByText("Not registered")).not.toBeInTheDocument();
    expect(
      screen.getByText(/task execution still need verification/),
    ).toBeVisible();
  });

  it("does not preserve a passing label after a failed recheck", async () => {
    fetchCheck
      .mockResolvedValueOnce(checked)
      .mockRejectedValueOnce(new Error("HTTP 503"));
    renderWithProviders(<RoleReadiness agentId="demo" onConfigure={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByText("Configured skills are registered"),
    );
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Skill status unconfirmed")).toBeVisible();
    expect(
      screen.queryByText("Configured skills are registered"),
    ).not.toBeInTheDocument();
  });

  it("discards a previous role's response after switching roles", async () => {
    let resolveFirst!: (value: RoleRegistrationCheck) => void;
    fetchCheck
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...checked, agent_id: "second", checks: [] });
    const { rerender } = renderWithProviders(
      <RoleReadiness agentId="demo" onConfigure={vi.fn()} />,
    );
    await waitFor(() => expect(fetchCheck).toHaveBeenCalledOnce());
    rerender(<RoleReadiness agentId="second" onConfigure={vi.fn()} />);
    expect(
      await screen.findByText("No additional skills configured"),
    ).toBeVisible();
    resolveFirst(checked);
    await waitFor(() =>
      expect(
        screen.queryByText("Configured skills are registered"),
      ).not.toBeInTheDocument(),
    );
  });
});
