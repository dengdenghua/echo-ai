import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ExecutionLocationPicker } from "./execution-location-picker";

const mock = vi.hoisted(() => ({
  remoteId: null as string | null,
  enabled: true,
  ping: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/core/config", () => ({ getLocalBackendBaseURL: () => "" }));
vi.mock("@/core/execution-location", () => ({
  getRemoteExecutionId: () => mock.remoteId,
  executionLocationURL: (id: string | null) =>
    id
      ? `/?echoRemote=${id}#/workspace/realtime/new`
      : "/#/workspace/realtime/new",
}));
vi.mock("@/hooks/use-remote-backends", () => ({
  useRemoteBackends: () => ({
    backends: [
      {
        id: "host-a",
        name: "Build machine",
        ssh: { host: "build.local" },
        last_health: "ok",
      },
    ],
    enabled: mock.enabled,
    loading: false,
    error: null,
    ping: mock.ping,
    refresh: mock.refresh,
  }),
}));
vi.mock("./remote-backends-panel", () => ({
  RemoteBackendsPanel: () => <div>Connection manager</div>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  mock.remoteId = null;
  mock.enabled = true;
  mock.ping.mockReset().mockResolvedValue({ status: "ok", detail: null });
  mock.refresh.mockReset().mockResolvedValue(undefined);
});

it("shows three locations with cloud availability and inline connection management", async () => {
  const user = userEvent.setup();
  renderWithProviders(<ExecutionLocationPicker />);
  await user.click(
    screen.getByRole("button", { name: "Run in: This computer" }),
  );
  expect(screen.getByRole("menuitem", { name: /Cloud/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(
    screen.getByText("No hosted platform or cloud executor connected"),
  ).toBeVisible();
  expect(screen.getByText("Not configured")).toBeVisible();
  await user.click(
    screen.getByRole("menuitem", { name: "Manage remote computers" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Connection manager");
});

it("checks the actual remote target before opening a fresh task", async () => {
  const user = userEvent.setup(),
    onNavigate = vi.fn();
  renderWithProviders(<ExecutionLocationPicker onNavigate={onNavigate} />);
  await user.click(
    screen.getByRole("button", { name: "Run in: This computer" }),
  );
  await user.click(
    screen.getByRole("menuitem", { name: /Remote.*connected computer/ }),
  );
  await user.type(screen.getByRole("searchbox"), "build");
  await user.click(screen.getByRole("menuitem", { name: /Build machine/ }));
  await waitFor(() =>
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(
      "/?echoRemote=host-a#/workspace/realtime/new",
    ),
  );
  expect(mock.ping).toHaveBeenCalledWith("host-a");
});

it("keeps the current runtime when the health check fails", async () => {
  mock.ping.mockResolvedValue({ status: "error", detail: "offline" });
  const user = userEvent.setup(),
    onNavigate = vi.fn();
  renderWithProviders(<ExecutionLocationPicker onNavigate={onNavigate} />);
  await user.click(
    screen.getByRole("button", { name: "Run in: This computer" }),
  );
  await user.click(
    screen.getByRole("menuitem", { name: /Remote.*connected computer/ }),
  );
  await user.click(screen.getByRole("menuitem", { name: /Build machine/ }));
  await waitFor(() => expect(mock.ping).toHaveBeenCalled());
  expect(onNavigate).not.toHaveBeenCalled();
});

it("keeps local switching reachable and preserves the disabled remote capability", async () => {
  mock.remoteId = "host-a";
  mock.enabled = false;
  const user = userEvent.setup(),
    onNavigate = vi.fn();
  renderWithProviders(<ExecutionLocationPicker onNavigate={onNavigate} />);
  expect(
    screen.getByRole("button", { name: "Choose computer" }),
  ).toHaveTextContent("Build machine");
  await user.click(screen.getByRole("button", { name: "Run in: Remote" }));
  expect(
    screen.getByRole("menuitem", { name: /Remote.*disabled/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("menuitem", { name: /This computer/ }));
  expect(onNavigate).toHaveBeenCalledWith("/#/workspace/realtime/new");
});

it("locks runtime changes while a turn or draft is pending", () => {
  renderWithProviders(<ExecutionLocationPicker disabled />);
  expect(
    screen.getByRole("button", { name: "Run in: This computer" }),
  ).toBeDisabled();
});
