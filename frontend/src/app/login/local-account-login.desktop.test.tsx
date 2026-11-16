import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const desktopLoginMock = vi.fn();

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    desktopLogin: desktopLoginMock,
    setupOwner: vi.fn(),
    login: vi.fn(),
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<
    typeof import("react-router-dom") // eslint-disable-line @typescript-eslint/consistent-type-imports
  >("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import { setDesktopAutoLoginEnabled } from "@/core/auth/desktop-auto-login";

import { DesktopOwnerLogin } from "./local-account-login";

function installDesktopBridge(): void {
  Object.defineProperty(window, "echo", {
    configurable: true,
    value: { auth: { desktopOwnerLogin: vi.fn() } },
  });
}

describe("DesktopOwnerLogin · auto sign-in", () => {
  beforeEach(() => {
    desktopLoginMock.mockReset();
    desktopLoginMock.mockResolvedValue(undefined);
    window.localStorage.clear();
    window.sessionStorage.clear();
    Reflect.deleteProperty(window, "echo");
  });

  it("signs the desktop owner in on mount, without a click", async () => {
    installDesktopBridge();

    render(<DesktopOwnerLogin />);

    await waitFor(() => expect(desktopLoginMock).toHaveBeenCalledTimes(1));
    // The manual button is still there as a fallback.
    expect(
      screen.getByRole("button", { name: /以本机账户继续/ }),
    ).toBeInTheDocument();
  });

  it("waits for the click when auto sign-in is switched off in settings", async () => {
    installDesktopBridge();
    setDesktopAutoLoginEnabled(false);

    render(<DesktopOwnerLogin />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(desktopLoginMock).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: /以本机账户继续/ }),
    );
    await waitFor(() => expect(desktopLoginMock).toHaveBeenCalledTimes(1));
  });

  it("does not auto sign in outside the desktop shell", async () => {
    render(<DesktopOwnerLogin />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(desktopLoginMock).not.toHaveBeenCalled();
  });
});