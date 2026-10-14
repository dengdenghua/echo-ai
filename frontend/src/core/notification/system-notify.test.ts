import { afterEach, describe, expect, it, vi } from "vitest";

import { showSystemNotification } from "./system-notify";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

describe("showSystemNotification", () => {
  afterEach(() => {
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    vi.unstubAllGlobals();
  });

  it("hands the notification to the Electron main process when available", () => {
    const show = vi.fn().mockResolvedValue({ ok: true, id: "tag" });
    window.echo = {
      notifications: { show, isSupported: vi.fn() },
    } as unknown as NonNullable<Window["echo"]>;
    vi.stubGlobal("Notification", FakeNotification);

    expect(
      showSystemNotification({
        title: "任务已完成",
        body: "周报",
        tag: "echo-attention:t1",
        href: "/workspace/realtime/t1",
        threadId: "t1",
      }),
    ).toBe(true);
    expect(show).toHaveBeenCalledWith({
      title: "任务已完成",
      body: "周报",
      tag: "echo-attention:t1",
      href: "/workspace/realtime/t1",
      threadId: "t1",
      silent: undefined,
    });
    // The renderer's own Notification is not used on desktop.
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("uses the Web Notification API in the browser and focuses on click", () => {
    vi.stubGlobal("Notification", FakeNotification);
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const onClick = vi.fn();

    expect(
      showSystemNotification(
        { title: "需要你的审批", body: "部署", tag: "echo-attention:t1" },
        { onClick },
      ),
    ).toBe(true);
    const [notification] = FakeNotification.instances;
    expect(notification?.options).toMatchObject({
      body: "部署",
      tag: "echo-attention:t1",
    });
    notification?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
    expect(notification?.close).toHaveBeenCalled();
  });

  it("shows nothing without browser permission", () => {
    FakeNotification.permission = "default";
    vi.stubGlobal("Notification", FakeNotification);
    expect(showSystemNotification({ title: "x" })).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });
});
