/**
 * One way to raise an OS notification from the renderer.
 *
 * Desktop: the Electron main process owns the notification (preload
 * ``window.echo.notifications``); clicking it restores and focuses the window
 * and sends ``notification:clicked`` back with the payload's ``href``. The
 * renderer's own HTML5 ``Notification`` is not used there: the shell denies
 * renderer permission requests and cannot reliably raise the window.
 *
 * Browser: the Web Notification API, which needs a granted permission.
 */
import { swallow } from "@/core/utils/log";

export interface SystemNotificationRequest {
  title: string;
  body?: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
  /** In-app route opened when the notification is clicked. */
  href?: string;
  threadId?: string;
  silent?: boolean;
}

export type DesktopNotificationBridge = NonNullable<
  NonNullable<Window["echo"]>["notifications"]
>;

export function desktopNotificationBridge(): DesktopNotificationBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.echo?.notifications;
  return bridge && typeof bridge.show === "function" ? bridge : null;
}

export function webNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Show a notification. Returns false when nothing could be shown (no API,
 * no permission). ``onClick`` runs for browser notifications; desktop clicks
 * arrive as the ``notification:clicked`` IPC event instead.
 */
export function showSystemNotification(
  request: SystemNotificationRequest,
  { onClick }: { onClick?: () => void } = {},
): boolean {
  const bridge = desktopNotificationBridge();
  if (bridge) {
    bridge
      .show({
        title: request.title,
        body: request.body,
        tag: request.tag,
        href: request.href,
        threadId: request.threadId,
        silent: request.silent,
      })
      .catch((error: unknown) => swallow(error, "desktop-notification"));
    return true;
  }
  if (!webNotificationsSupported() || Notification.permission !== "granted") {
    return false;
  }
  try {
    const notification = new Notification(request.title, {
      body: request.body,
      tag: request.tag,
      silent: request.silent,
    });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
    return true;
  } catch (error) {
    swallow(error, "web-notification");
    return false;
  }
}
