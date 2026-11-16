import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDesktopSidebarOpen,
  saveDesktopSidebarOpen,
} from "./desktop-sidebar-preference";

beforeEach(() => {
  localStorage.clear();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});
afterEach(() => vi.restoreAllMocks());

describe("desktop sidebar persistence", () => {
  it("restores collapse and reopening even when the desktop origin has no cookies", () => {
    vi.spyOn(document, "cookie", "get").mockReturnValue("");
    saveDesktopSidebarOpen(false);
    expect(readDesktopSidebarOpen()).toBe(false);
    saveDesktopSidebarOpen(true);
    expect(readDesktopSidebarOpen()).toBe(true);
  });

  it("reads the old browser cookie until the user saves a newer choice", () => {
    document.cookie = "sidebar_state=false; path=/";
    expect(readDesktopSidebarOpen()).toBe(false);
    saveDesktopSidebarOpen(true);
    expect(readDesktopSidebarOpen()).toBe(true);
  });

  it("keeps the cookie fallback usable when local storage is blocked", () => {
    document.cookie = "sidebar_state=false; path=/";
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => saveDesktopSidebarOpen(true)).not.toThrow();
    expect(readDesktopSidebarOpen()).toBe(false);
  });

  it("falls back to the default when both preference stores are unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(document, "cookie", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readDesktopSidebarOpen()).toBe(true);
  });
});
