import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test/harness";

const navigateMock = vi.fn();
const setupOwnerMock = vi.fn();
const loginMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<
    typeof import("react-router-dom") // eslint-disable-line @typescript-eslint/consistent-type-imports
  >("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    setupOwner: setupOwnerMock,
    login: loginMock,
    desktopLogin: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import { OwnerAccountForm } from "./local-account-login";

const setupProvider = {
  id: "local",
  label: "本机账户",
  owner_account: true,
  owner_setup_required: true,
  owner_username: null,
  password_required: true,
  setup_code_path: "C:\\echo\\data\\auth\\owner-setup-code.txt",
};

function renderForm(provider = setupProvider) {
  return renderWithProviders(
    <OwnerAccountForm provider={provider} returnTo="/workspace" />,
    { locale: "zh-CN" },
  );
}

describe("OwnerAccountForm", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setupOwnerMock.mockReset();
    loginMock.mockReset();
  });

  it("creates the owner with the setup code and signs in", async () => {
    const user = userEvent.setup();
    setupOwnerMock.mockResolvedValue(undefined);
    renderForm();

    expect(screen.getByText(setupProvider.setup_code_path)).toBeTruthy();
    await user.type(screen.getByLabelText("设置码"), "abcd-efgh-jkmn");
    await user.type(screen.getByLabelText("用户名"), "ada");
    await user.type(screen.getByLabelText("密码"), "correct horse");
    await user.type(screen.getByLabelText("确认密码"), "correct horse");
    await user.click(screen.getByRole("button", { name: /创建本机账户/ }));

    expect(setupOwnerMock).toHaveBeenCalledWith({
      username: "ada",
      password: "correct horse",
      setup_code: "abcd-efgh-jkmn",
    });
    expect(navigateMock).toHaveBeenCalledWith("/workspace", { replace: true });
  });

  it("checks the form before asking the server", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("用户名"), "a b");
    await user.type(screen.getByLabelText("密码"), "short");
    await user.type(screen.getByLabelText("确认密码"), "other");
    await user.click(screen.getByRole("button", { name: /创建本机账户/ }));

    expect(screen.getByText("请输入设置码")).toBeTruthy();
    expect(screen.getByText("用户名只能包含字母、数字和 . _ @ -")).toBeTruthy();
    expect(screen.getByText("密码至少需要 8 个字符")).toBeTruthy();
    expect(screen.getByText("两次输入的密码不一致")).toBeTruthy();
    expect(setupOwnerMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the code is wrong", async () => {
    const user = userEvent.setup();
    setupOwnerMock.mockRejectedValue(new Error("设置码不正确"));
    renderForm();

    await user.type(screen.getByLabelText("设置码"), "wrong");
    await user.type(screen.getByLabelText("用户名"), "ada");
    await user.type(screen.getByLabelText("密码"), "correct horse");
    await user.type(screen.getByLabelText("确认密码"), "correct horse");
    await user.click(screen.getByRole("button", { name: /创建本机账户/ }));

    expect(await screen.findByText("设置码不正确")).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("signs the existing owner in with a password", async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValue(undefined);
    renderForm({
      ...setupProvider,
      owner_setup_required: false,
      owner_username: "ada",
      setup_code_path: undefined,
    });

    expect(screen.getByLabelText("用户名")).toHaveProperty("value", "ada");
    expect(screen.queryByLabelText("设置码")).toBeNull();
    await user.type(screen.getByLabelText("密码"), "correct horse");
    await user.click(screen.getByRole("button", { name: /进入 ECHO/ }));

    expect(loginMock).toHaveBeenCalledWith({
      username: "ada",
      password: "correct horse",
    });
    expect(navigateMock).toHaveBeenCalledWith("/workspace", { replace: true });
  });
});
