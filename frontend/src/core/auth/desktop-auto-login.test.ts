import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDesktopAutoLoginSuppression,
  desktopAutoLoginAvailable,
  isDesktopAutoLoginEnabled,
  setDesktopAutoLoginEnabled,
  shouldAutoLoginDesktopOwner,
  suppressDesktopAutoLogin,
} from "./desktop-auto-login";

function installDesktopBridge(): void {
  Object.defineProperty(window, "echo", {
    configurable: true,
    value: { auth: { desktopOwnerLogin: vi.fn() } },
  });
}

describe("desktop auto sign-in preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    Reflect.deleteProperty(window, "echo");
  });

  it("is on by default so a desktop launch does not need a click", () => {
    installDesktopBridge();

    expect(isDesktopAutoLoginEnabled()).toBe(true);
    expect(shouldAutoLoginDesktopOwner()).toBe(true);
  });

  it("stays off once switched off, across reloads", () => {
    installDesktopBridge();

    setDesktopAutoLoginEnabled(false);

    expect(isDesktopAutoLoginEnabled()).toBe(false);
    expect(shouldAutoLoginDesktopOwner()).toBe(false);
    expect(window.localStorage.getItem("echo_desktop_auto_login")).toBe("0");
  });

  it("never auto signs in without the desktop bridge", () => {
    expect(desktopAutoLoginAvailable()).toBe(false);
    expect(shouldAutoLoginDesktopOwner()).toBe(false);
  });

  it("an explicit sign-out suppresses auto sign-in for the session", () => {
    installDesktopBridge();

    suppressDesktopAutoLogin();

    expect(shouldAutoLoginDesktopOwner()).toBe(false);
    // The suppression lives in sessionStorage: a relaunch starts clean.
    expect(window.sessionStorage.getItem("echo_desktop_signed_out")).toBe("1");
    expect(isDesktopAutoLoginEnabled()).toBe(true);
  });

  it("a successful sign-in clears the suppression again", () => {
    installDesktopBridge();
    suppressDesktopAutoLogin();

    clearDesktopAutoLoginSuppression();

    expect(shouldAutoLoginDesktopOwner()).toBe(true);
  });

  it("re-enabling the switch also clears a stale sign-out suppression", () => {
    installDesktopBridge();
    setDesktopAutoLoginEnabled(false);
    suppressDesktopAutoLogin();

    setDesktopAutoLoginEnabled(true);

    expect(shouldAutoLoginDesktopOwner()).toBe(true);
  });
});