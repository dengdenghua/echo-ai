import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";

import { renderWithProviders } from "@/test/harness";
import { AutomationConfiguredTab } from "./automation-configured-tab";
import { AutomationCreateDialog } from "./automation-create-dialog";

vi.mock("@/core/config", () => ({ getBackendBaseURL: () => "" }));

let subscriptions: Array<Record<string, unknown>>;
const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  subscriptions = [
    {
      id: "sub-1",
      topic: "Release updates",
      display_name: "Release updates",
      enabled: false,
      cadence: "每天",
      schedule_time: "09:00",
      timezone: "Asia/Shanghai",
      last_run: "2026-10-01T01:00:00Z",
      next_check_at: null,
    },
  ];
  fetchMock
    .mockReset()
    .mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/run")) {
        subscriptions[0]!.last_run = "2026-10-05T01:00:00Z";
        return Response.json({ ok: true, report: {} });
      }
      if (init?.method === "PATCH") {
        Object.assign(subscriptions[0]!, JSON.parse(String(init.body)));
        subscriptions[0]!.next_check_at = subscriptions[0]!.enabled
          ? "2030-10-05T01:00:00Z"
          : null;
        return Response.json(subscriptions[0]);
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        subscriptions.push({
          ...body,
          id: "sub-2",
          next_check_at: "2030-10-05T01:00:00Z",
        });
        return Response.json(subscriptions[1]);
      }
      return Response.json({ subscriptions });
    });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("allows one manual run while paused and refreshes run history", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["intelligence", "history"], []);
  client.setQueryData(["intelligence", "reports"], []);
  const user = userEvent.setup();
  renderWithProviders(<AutomationConfiguredTab />, { queryClient: client });
  expect(await screen.findByText("Paused")).toBeVisible();
  expect(screen.getByTestId("automation-execution-location")).toHaveTextContent(
    "Runs on the current Echo service",
  );
  await user.click(
    screen.getByRole("button", {
      name: "Run subscription now: Release updates",
    }),
  );
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => url.endsWith("/sub-1/run") && init?.method === "POST",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      client.getQueryState(["intelligence", "history"])?.isInvalidated,
    ).toBe(true),
  );
  expect(client.getQueryState(["intelligence", "reports"])?.isInvalidated).toBe(
    true,
  );
  expect(screen.getByText("Paused")).toBeVisible();
});

it("shows the server's next check after resuming and correctly labels the screen wake control", async () => {
  const user = userEvent.setup();
  renderWithProviders(<AutomationConfiguredTab />);
  await screen.findByText("Paused");
  expect(
    screen.getByRole("switch", { name: "Keep this screen awake" }),
  ).toBeDisabled();
  expect(screen.queryByText("Don't show again")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("switch", {
      name: "Enable subscription: Release updates",
    }),
  );
  await screen.findByText("Enabled");
  expect(screen.getByText(/Next eligible check/)).toHaveTextContent("Oct 5");
  expect(screen.getByText("Daily at 09:00 · Asia/Shanghai")).toBeVisible();
});

it("shows a service error with retry instead of an empty task list", async () => {
  fetchMock.mockRejectedValue(new Error("Request failed: 503"));
  const user = userEvent.setup();
  renderWithProviders(<AutomationConfiguredTab />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The service is unavailable",
  );
  fetchMock.mockImplementation(async () => Response.json({ subscriptions }));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Release updates")).toBeVisible();
});

it("refreshes an already open list immediately after creating a task", async () => {
  function View() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <AutomationConfiguredTab />
        <AutomationCreateDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  const user = userEvent.setup();
  renderWithProviders(<View />);
  await screen.findByTestId("automation-task-sub-1");
  await user.type(
    screen.getByRole("textbox", { name: "Task name" }),
    "Follow release notes",
  );
  await user.type(screen.getByRole("textbox", { name: "Topic" }), "release");
  await user.click(
    screen.getByRole("button", { name: "Create task", exact: true }),
  );
  expect(await screen.findByTestId("automation-task-sub-2")).toHaveTextContent(
    "Follow release notes",
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("identifies the selected remote service as the executor", async () => {
  window.history.replaceState({}, "", "/?echoRemote=host-a");
  renderWithProviders(<AutomationConfiguredTab />);
  expect(
    await screen.findByTestId("automation-execution-location"),
  ).toHaveTextContent("Runs on the selected remote computer");
});
