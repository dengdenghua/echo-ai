import { describe, expect, it, vi } from "vitest";
import {
  registerClipboardWrite,
  isTrustedClipboardFrame,
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

  it("writes exact text and rejects invalid or untrusted requests without writing", () => {
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
    expect(invoke({ trusted: true }, value)).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith(value);
    expect(invoke({}, "denied").ok).toBe(false);
    expect(invoke({ trusted: true }, { text: "bad" }).ok).toBe(false);
    expect(invoke({ trusted: true }, "x".repeat(4_000_001)).ok).toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
