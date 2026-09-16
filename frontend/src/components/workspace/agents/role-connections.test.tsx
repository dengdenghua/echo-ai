import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { inspectRequiredConnections } from "@/core/agents/required-connections";
import { RoleConnections } from "./role-connections";

vi.mock("@/core/agents/required-connections", () => ({
  inspectRequiredConnections: vi.fn(),
}));
vi.mock("@/components/store/capability-market-panel", () => ({
  CapabilityMarketPanel: ({
    requiredCapabilityIds,
  }: {
    requiredCapabilityIds: string[];
  }) => <p>Manage only {requiredCapabilityIds.join(",")}</p>,
}));
const inspect = vi.mocked(inspectRequiredConnections);

describe("role connections", () => {
  beforeEach(() => inspect.mockReset());

  it("opens the exact dependency and rechecks after closing the existing manager", async () => {
    inspect
      .mockResolvedValueOnce([{ id: "mail", name: "Mail", state: "connect" }])
      .mockResolvedValueOnce([
        { id: "mail", name: "Mail", state: "configured" },
      ]);
    renderWithProviders(
      <RoleConnections agentId="eve" connectors={["mail"]} mcpServers={[]} />,
    );
    const user = userEvent.setup();
    expect(await screen.findByText("Mail · Connection required")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Manage connection" }));
    expect(await screen.findByText("Manage only mail")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      await screen.findByText("Mail · Connection configured"),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/still need a real call/)).toBeVisible();
  });

  it("removes passing results during recheck and when the request fails", async () => {
    let reject!: (error: Error) => void;
    inspect
      .mockResolvedValueOnce([
        { id: "mail", name: "Mail", state: "configured" },
      ])
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
    renderWithProviders(
      <RoleConnections agentId="eve" connectors={["mail"]} mcpServers={[]} />,
    );
    expect(
      await screen.findByText("Mail · Connection configured"),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Check connections again" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Checking connections",
    );
    expect(
      screen.queryByText("Mail · Connection configured"),
    ).not.toBeInTheDocument();
    await act(async () => reject(new Error("network")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection status unavailable",
    );
    expect(
      screen.queryByText("Mail · Connection configured"),
    ).not.toBeInTheDocument();
  });

  it("does not query connectors or imply success for an external MCP declaration", () => {
    renderWithProviders(
      <RoleConnections
        agentId="eve"
        connectors={[]}
        mcpServers={["external"]}
      />,
    );
    expect(
      screen.getByText(/external · External MCP unverified/),
    ).toBeVisible();
    expect(inspect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Check connections again" }),
    ).not.toBeInTheDocument();
  });

  it("aborts the old lookup and discards its result after switching roles", async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof inspectRequiredConnections>>,
    ) => void;
    inspect
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce([
        { id: "calendar", name: "Calendar", state: "disabled" },
      ]);
    const { rerender } = renderWithProviders(
      <RoleConnections agentId="eve" connectors={["mail"]} mcpServers={[]} />,
    );
    await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    const signal = inspect.mock.calls[0]![1]!;
    rerender(
      <RoleConnections
        agentId="other"
        connectors={["calendar"]}
        mcpServers={[]}
      />,
    );
    expect(await screen.findByText("Calendar · Not enabled")).toBeVisible();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish([{ id: "mail", name: "Mail", state: "configured" }]),
    );
    expect(screen.queryByText(/Mail ·/)).not.toBeInTheDocument();
  });
});
