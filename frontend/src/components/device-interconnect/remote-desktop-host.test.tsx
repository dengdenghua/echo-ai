import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteDesktopHost } from "./remote-desktop-host";

vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer operator" }),
}));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8000",
}));
afterEach(() => vi.unstubAllGlobals());

it("starts denied and explicitly grants the selected phone; revoke stays available offline", async () => {
  const status = {
    state: "ready",
    permissions: {},
    active: [],
    relayConfigured: false,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => status });
  vi.stubGlobal("fetch", fetcher);
  const { rerender } = render(<RemoteDesktopHost deviceId="phone/a" online />);
  const select = await screen.findByLabelText("此手机的电脑远控权限");
  await waitFor(() => expect(select).toBeEnabled());
  expect(select).toHaveValue("denied");
  fireEvent.change(select, { target: { value: "control" } });
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("permissions/phone%2Fa"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ mode: "control" }),
        credentials: "include",
      }),
    ),
  );
  rerender(<RemoteDesktopHost deviceId="phone/a" online={false} />);
  await waitFor(() => expect(select).toBeEnabled());
  expect(screen.getByRole("option", { name: "不允许" })).toBeEnabled();
  expect(screen.getByRole("option", { name: "允许观看与操作" })).toBeDisabled();
});

it("reports component failure and blocks granting new control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "component_missing",
        permissions: {},
        active: [],
      }),
    }),
  );
  render(<RemoteDesktopHost deviceId="phone" online />);
  expect(
    await screen.findByText("远控组件尚未就绪，请更新 Echo 桌面端。"),
  ).toBeVisible();
  expect(screen.getByRole("option", { name: "允许观看与操作" })).toBeDisabled();
});
