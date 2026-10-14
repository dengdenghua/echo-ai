import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openExternalAuthPopup,
  openExternalAuthTab,
  safeExternalAuthUrl,
} from "./external-auth-url";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safeExternalAuthUrl", () => {
  it("accepts http(s) pages", () => {
    expect(safeExternalAuthUrl(" https://github.com/login/device ")).toBe(
      "https://github.com/login/device",
    );
    expect(safeExternalAuthUrl("http://127.0.0.1:1455/auth")).toBe(
      "http://127.0.0.1:1455/auth",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///etc/passwd",
    "vbscript:msgbox",
    "/relative/path",
    "",
    null,
    undefined,
  ])("refuses %s", (raw) => {
    expect(safeExternalAuthUrl(raw)).toBeNull();
  });
});

describe("openExternalAuthPopup", () => {
  it("severs window.opener on the popup it returns", () => {
    const popup = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    expect(openExternalAuthPopup("https://example.com/a", "echo-x", "popup=yes")).toBe(popup);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "echo-x", "popup=yes");
    expect(popup.opener).toBeNull();
  });

  it("never opens a refused URL", () => {
    const open = vi.spyOn(window, "open");
    expect(openExternalAuthPopup("javascript:alert(1)", "echo-x")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("openExternalAuthTab", () => {
  it("opens with noopener,noreferrer", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openExternalAuthTab("https://example.com/device")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/device",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("refuses non-http(s) URLs", () => {
    const open = vi.spyOn(window, "open");
    expect(openExternalAuthTab("data:text/html,x")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
