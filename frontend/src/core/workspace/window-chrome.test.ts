import { describe, expect, it } from "vitest";
import { resolveWindowChrome, sharesWorkspaceTitlebar } from "./window-chrome";

describe("native window chrome policy", () => {
  it("shares the Windows toolbar row and reserves space for native buttons", () => {
    const chrome = resolveWindowChrome("win32", true, false, true, true);
    expect(chrome).toMatchObject({
      integratedToolbar: true,
      contentTopInset: "0px",
      titleBarHeight: 36,
      controlsSide: "right",
    });
    expect(chrome.controlsSafeInset).toContain("138px");
  });
  it("reserves the left side for macOS traffic lights in a shared toolbar", () => {
    expect(
      resolveWindowChrome("darwin", true, false, true, true),
    ).toMatchObject({
      integratedToolbar: true,
      contentTopInset: "0px",
      controlsSide: "left",
      controlsSafeInset: "80px",
    });
  });
  it("keeps the shared toolbar stable while releasing controls space in fullscreen", () => {
    expect(resolveWindowChrome("win32", true, true, true, true)).toMatchObject({
      integratedToolbar: true,
      contentTopInset: "0px",
      controlsSafeInset: "0px",
      titleBarHeight: 0,
    });
  });
  it("only integrates the toolbar for framed workspace and browser routes", () => {
    for (const pathname of [
      "/workspace",
      "/workspace/realtime/new",
      "/browser",
    ])
      expect(sharesWorkspaceTitlebar(pathname, "")).toBe(true);
    for (const pathname of ["/login", "/share/token", "/workspace-other"])
      expect(sharesWorkspaceTitlebar(pathname, "")).toBe(false);
    expect(
      sharesWorkspaceTitlebar("/workspace/realtime/new", "?embedded=app"),
    ).toBe(false);
    expect(
      sharesWorkspaceTitlebar("/workspace/realtime/new", "?embedded=design"),
    ).toBe(false);
  });
  it("reserves a separate row above the app header for Windows controls", () => {
    expect(resolveWindowChrome("win32", true)).toMatchObject({
      controlsSide: "right",
      titleBarHeight: 36,
      titleBarInset: "env(titlebar-area-height, 36px)",
      contentTopInset: "env(titlebar-area-height, 36px)",
      controlsSafeInset: "0px",
      macTrafficLightsWidth: 0,
    });
  });
  it("retains native macOS traffic lights on the left", () => {
    expect(resolveWindowChrome("darwin", true)).toMatchObject({
      controlsSide: "left",
      titleBarHeight: 36,
      titleBarInset: "36px",
      contentTopInset: "36px",
      controlsSafeInset: "0px",
      macTrafficLightsWidth: 80,
    });
  });
  it("lets Linux use its system frame without a second reserved row", () => {
    expect(resolveWindowChrome("linux", true)).toMatchObject({
      controlsSide: "system",
      titleBarHeight: 0,
      titleBarInset: "0px",
    });
  });
  it.each(["darwin", "win32", "linux"])(
    "does not emulate OS buttons in a %s web browser",
    (platform) => {
      expect(resolveWindowChrome(platform, false)).toMatchObject({
        controlsSide: "none",
        titleBarHeight: 0,
      });
    },
  );
  it.each(["darwin", "win32"])(
    "does not duplicate the system title bar in a %s auxiliary window",
    (platform) => {
      expect(resolveWindowChrome(platform, true, false, false)).toMatchObject({
        titleBarHeight: 0,
        titleBarInset: "0px",
        contentTopInset: "0px",
        controlsSafeInset: "0px",
        macTrafficLightsWidth: 0,
      });
    },
  );
  it.each(["darwin", "win32"])(
    "reclaims the reserved title area in %s fullscreen",
    (platform) => {
      expect(resolveWindowChrome(platform, true, true)).toMatchObject({
        titleBarHeight: 0,
        titleBarInset: "0px",
        contentTopInset: "0px",
        controlsSafeInset: "0px",
        macTrafficLightsWidth: 0,
      });
    },
  );
});
