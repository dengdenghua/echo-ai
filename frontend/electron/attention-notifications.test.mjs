import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import attentionNotifications from "./attention-notifications.cjs";

const {
  createAttentionNotifications,
  normalizeNotificationPayload,
  sanitizeAppRoute,
} = attentionNotifications;

function fakeElectron({ supported = true } = {}) {
  const shown = [];
  class FakeNotification extends EventEmitter {
    static isSupported = vi.fn(() => supported);
    constructor(options) {
      super();
      this.options = options;
      this.show = vi.fn();
      this.close = vi.fn(() => this.emit("close"));
      shown.push(this);
    }
  }
  const webContents = {
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const win = {
    webContents,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => true),
    isVisible: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return { FakeNotification, shown, win, webContents };
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
  };
}

describe("attention notification payloads", () => {
  it("keeps only in-app routes", () => {
    expect(sanitizeAppRoute("/workspace/realtime/t%201")).toBe(
      "/workspace/realtime/t%201",
    );
    for (const denied of [
      "https://example.com/",
      "//example.com/x",
      "javascript:alert(1)",
      "/\\evil",
      "/workspace\n/x",
      42,
    ]) {
      expect(sanitizeAppRoute(denied)).toBeNull();
    }
  });

  it("requires a title and bounds every field", () => {
    expect(normalizeNotificationPayload({ body: "x" })).toBeNull();
    expect(normalizeNotificationPayload(null)).toBeNull();
    const payload = normalizeNotificationPayload({
      title: "任务\u0007已完成\n",
      body: `周报\n点击查看。\u0000${"x".repeat(1_000)}`,
      tag: "echo-attention:t1",
      href: "https://evil.example",
      threadId: "t1",
      silent: "yes",
    });
    expect(payload).toMatchObject({
      title: "任务 已完成",
      tag: "echo-attention:t1",
      href: null,
      threadId: "t1",
      silent: false,
    });
    expect(payload.body.startsWith("周报\n点击查看。")).toBe(true);
    expect(payload.body.length).toBe(attentionNotifications.MAX_BODY_LENGTH);
  });
});

describe("main-process attention notifications", () => {
  it("shows a notification and routes its click back to the window", () => {
    const { FakeNotification, shown, win, webContents } = fakeElectron();
    const notifications = createAttentionNotifications({
      Notification: FakeNotification,
      getMainWindow: () => win,
    });

    expect(
      notifications.show({
        title: "需要你的审批",
        body: "部署\n点击前往处理。",
        tag: "echo-attention:t1",
        href: "/workspace/realtime/t1",
        threadId: "t1",
      }),
    ).toEqual({ ok: true, id: "echo-attention:t1" });
    const [note] = shown;
    expect(note.options).toEqual({
      title: "需要你的审批",
      body: "部署\n点击前往处理。",
      silent: false,
    });
    expect(note.show).toHaveBeenCalled();

    note.emit("click");
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(webContents.send).toHaveBeenCalledWith("notification:clicked", {
      href: "/workspace/realtime/t1",
      threadId: "t1",
      tag: "echo-attention:t1",
    });
    expect(notifications.liveCount()).toBe(0);
  });

  it("replaces the previous notification with the same tag", () => {
    const { FakeNotification, shown, win } = fakeElectron();
    const notifications = createAttentionNotifications({
      Notification: FakeNotification,
      getMainWindow: () => win,
    });
    notifications.show({ title: "任务已暂停", tag: "echo-attention:t1" });
    notifications.show({ title: "任务已完成", tag: "echo-attention:t1" });
    expect(shown[0].close).toHaveBeenCalled();
    expect(shown[1].close).not.toHaveBeenCalled();
    expect(notifications.liveCount()).toBe(1);
  });

  it("refuses invalid payloads and unsupported platforms", () => {
    const unsupported = fakeElectron({ supported: false });
    expect(
      createAttentionNotifications({
        Notification: unsupported.FakeNotification,
        getMainWindow: () => unsupported.win,
      }).show({ title: "x" }),
    ).toEqual({ ok: false, reason: "unsupported" });

    const { FakeNotification, win, shown } = fakeElectron();
    expect(
      createAttentionNotifications({
        Notification: FakeNotification,
        getMainWindow: () => win,
      }).show({ title: "   " }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(shown).toHaveLength(0);
  });

  it("registers IPC that only the app's own windows may use", async () => {
    const { FakeNotification, shown, win, webContents } = fakeElectron();
    const ipcMain = fakeIpcMain();
    createAttentionNotifications({
      Notification: FakeNotification,
      getMainWindow: () => win,
      windowForContents: (contents) => (contents === webContents ? win : null),
      isTrustedSender: (contents) => contents === webContents,
    }).registerIpc(ipcMain);

    expect(await ipcMain.handlers.get("notifications:isSupported")()).toBe(
      true,
    );
    const show = ipcMain.handlers.get("notifications:show");
    expect(
      await show({ sender: { isDestroyed: () => false } }, { title: "x" }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(shown).toHaveLength(0);

    expect(
      await show(
        { sender: webContents },
        { title: "任务失败", href: "/workspace/realtime/t2" },
      ),
    ).toMatchObject({ ok: true });
    shown[0].emit("click");
    expect(webContents.send).toHaveBeenCalledWith(
      "notification:clicked",
      expect.objectContaining({ href: "/workspace/realtime/t2" }),
    );
  });
});
