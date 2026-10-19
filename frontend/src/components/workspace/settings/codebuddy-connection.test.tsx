import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { CodeBuddyConnection } from "./codebuddy-connection";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/core/api/request", async (original) => ({
  ...(await original<typeof import("@/core/api/request")>()),
  apiGet: api.get,
  apiPost: api.post,
}));

it("keeps installation separate from login, launches the CLI only on request and links real credits", async () => {
  api.get.mockImplementation(async (path) =>
    path.endsWith("/models")
      ? { models: ["hy3"] }
      : { available: true, login_launch_supported: true },
  );
  api.post.mockResolvedValue({ launched: true, flow: "official_cli" });
  const user = userEvent.setup();
  renderWithProviders(<CodeBuddyConnection />, { locale: "zh-CN" });
  await screen.findByText("已检测到官方 CLI");
  expect(screen.getByText(/安装就绪不代表已登录/)).toBeVisible();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "查看剩余积分" })).toHaveAttribute(
    "href",
    "https://www.codebuddy.cn/profile/plans-usage",
  );
  await user.click(screen.getByRole("button", { name: "登录 / 重新授权" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/api/config/codebuddy/login"),
  );
  expect(await screen.findByText(/输入 \/login/)).toBeVisible();
});
