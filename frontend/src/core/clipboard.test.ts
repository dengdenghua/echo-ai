import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("copyTextToClipboard", () => {
  it("uses the native write bridge even when Chromium clipboard permission is denied", async () => {
    const native = vi.fn().mockResolvedValue({ ok: true });
    const browser = vi.fn().mockRejectedValue(new Error("permission denied"));
    vi.stubGlobal("echo", { clipboard: { writeText: native } });
    vi.stubGlobal("navigator", { clipboard: { writeText: browser } });
    await copyTextToClipboard("中文消息\n**保留 Markdown**");
    expect(native).toHaveBeenCalledWith("中文消息\n**保留 Markdown**");
    expect(browser).not.toHaveBeenCalled();
  });

  it("keeps web copying working if the native bridge fails", async () => {
    vi.stubGlobal("echo", {
      clipboard: { writeText: vi.fn().mockResolvedValue({ ok: false }) },
    });
    const browser = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: browser } });
    await copyTextToClipboard("web message");
    expect(browser).toHaveBeenCalledWith("web message");
  });

  it("uses DOM fallback without a Clipboard API and restores the input focus", async () => {
    vi.stubGlobal("echo", undefined);
    vi.stubGlobal("navigator", {});
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: exec,
      configurable: true,
    });
    await copyTextToClipboard("fallback");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(input);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects when every copy route is blocked", async () => {
    vi.stubGlobal("echo", undefined);
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    await expect(copyTextToClipboard("blocked")).rejects.toThrow(
      "Clipboard copy was blocked",
    );
  });
});
