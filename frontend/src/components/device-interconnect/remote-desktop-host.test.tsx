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

it.each([
  ["direct", "直连"],
  ["turn", "TURN 中继"],
  ["wss", "WSS 兼容连接"],
  [undefined, "路径检测中"],
])(
  "shows the active %s path independently from configured TURN",
  async (path, label) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "ready",
          permissions: {},
          relayConfigured: true,
          active: [
            {
              deviceId: "phone",
              state: "connected",
              permission: "view",
              connectionPath: path,
            },
          ],
        }),
      }),
    );
    render(<RemoteDesktopHost deviceId="phone" online />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "phone · " + label,
    );
  },
);

it("distinguishes configured video relay from a verified external gateway", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "ready",
        permissions: {},
        active: [],
        relayConfigured: true,
        inputFocusHints: true,
      }),
    }),
  );
  render(<RemoteDesktopHost deviceId="phone" online />);
  const note = await screen.findByText(
    /异地使用前，请先配置安全连接入口并完成外网测试/,
  );
  expect(note).toHaveTextContent("画面中继已配置");
  expect(note).toHaveTextContent("自动打开手机输入栏");
});

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
