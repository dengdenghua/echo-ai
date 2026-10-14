import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ModelSharingSettings } from "./model-sharing-settings";

vi.mock("@/components/workspace/codex-hotspot-panel", () => ({
  CodexHotspotPanel: () => <button>分享我的模型</button>,
}));
const auth = vi.hoisted(() => ({ roles: ["user", "admin"] }));
vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => ({
    authStatus: { enabled: true },
    user: { user_id: "local:owner", roles: auth.roles },
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  auth.roles = ["user", "admin"];
});

it("does not call admin-only team gateway endpoints for an ordinary account", () => {
  // Regression: opening 设置 → 模型 as an ordinary account fired
  // GET /api/team-gateway/connections, which answers 403 to non-admins.
  auth.roles = ["user", "local"];
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ connections: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<ModelSharingSettings onConnected={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /团队模型.*使用/ }));
  expect(screen.getByText(/团队模型由这台电脑的管理员配置/)).toBeVisible();
  expect(screen.queryByText("加入团队")).toBeNull();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/api/team-gateway/"),
    ),
  ).toBe(false);
});

it("keeps connection drafts while switching sharing modes without submitting", () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ connections: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<ModelSharingSettings onConnected={vi.fn()} />);
  expect(screen.getByLabelText("模型地址")).not.toBeVisible();
  fireEvent.click(screen.getByText("连接共享模型"));
  fireEvent.change(screen.getByLabelText("模型地址"), {
    target: { value: "https://example.com/v1" },
  });
  expect(screen.getByRole("button", { name: "验证并读取模型" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /团队模型.*使用/ }));
  expect(screen.getByLabelText("模型地址")).not.toBeVisible();
  fireEvent.click(screen.getByText("加入团队"));
  expect(screen.getByLabelText("团队网关地址")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: /个人共享.*连接/ }));
  expect(screen.getByLabelText("模型地址")).toHaveValue(
    "https://example.com/v1",
  );
  expect(fetchMock.mock.calls).toHaveLength(1);
});
