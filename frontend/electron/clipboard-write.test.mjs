import { describe, expect, it, vi } from "vitest";
import {
  registerClipboardWrite,
  isTrustedClipboardFrame,
  writeClipboardText,
} from "./clipboard-write.cjs";

describe("native clipboard write", () => {
  it("permits only the owned application main frame", () => {
    const frame = { url: "echo-app://app/index.html" };
    const sender = { mainFrame: frame };
    const policy = {
      isAppContents: (s) => s === sender,
      isAppURL: (u) => u.startsWith("echo-app://app/"),
      devURL: null,
    };
    expect(
      isTrustedClipboardFrame({ sender, senderFrame: frame }, policy),
    ).toBe(true);
    expect(
      isTrustedClipboardFrame({ sender, senderFrame: { ...frame } }, policy),
    ).toBe(false);
    expect(
      isTrustedClipboardFrame(
        { sender: { mainFrame: frame }, senderFrame: frame },
        policy,
      ),
    ).toBe(false);
    frame.url = "https://external.example/";
    expect(
      isTrustedClipboardFrame({ sender, senderFrame: frame }, policy),
    ).toBe(false);
  });

  it("writes exact text and rejects invalid or untrusted requests without writing", async () => {
    const handle = vi.fn();
    const writeText = vi.fn();
    registerClipboardWrite({
      ipcMain: { handle },
      clipboard: { writeText },
      isTrustedSender: (e) => e.trusted === true,
    });
    expect(handle.mock.calls[0][0]).toBe("clipboard:writeText");
    const invoke = handle.mock.calls[0][1];
    const value = "中文\n```ts\nconst a = 1;\n```";
    expect(await invoke({ trusted: true }, value)).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith(value);
    expect((await invoke({}, "denied")).ok).toBe(false);
    expect((await invoke({ trusted: true }, { text: "bad" })).ok).toBe(false);
    expect((await invoke({ trusted: true }, "x".repeat(4_000_001))).ok).toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge an asynchronous OS write until it completes", async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const result = writeClipboardText({ writeText: () => pending }, "中文");
    const acknowledged = vi.fn();
    void result.then(acknowledged);
    await Promise.resolve();
    expect(acknowledged).not.toHaveBeenCalled();
    finish();
    expect(await result).toEqual({ ok: true });
  });

  it("contains asynchronous clipboard failures instead of a false success", async () => {
    const handle = vi.fn();
    registerClipboardWrite({ ipcMain: { handle }, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("OS denied")) }, isTrustedSender: () => true });
    await expect(handle.mock.calls[0][1]({}, "中文")).resolves.toEqual({ ok: false, error: "Unable to copy text" });
  });
});
