"use strict";

// OS notifications for the renderer's long-task attention notifier
// (src/core/notification). The main process owns them so a click can
// restore and focus the window — the renderer's HTML5 Notification can't —
// and then tell the renderer which in-app route to open.

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 400;
const MAX_TAG_LENGTH = 200;
const MAX_ROUTE_LENGTH = 2048;
// Shown notifications are held until clicked/closed: an unreferenced
// Electron Notification can be garbage-collected and lose its click handler.
const MAX_LIVE_NOTIFICATIONS = 20;

// Single-line fields drop every control character; the body keeps its
// line breaks (thread title on the first line, a hint on the second).
const LINE_CONTROLS = /[\u0000-\u001f\u007f]+/g;
const BODY_CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f]+/g;
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

function cleanText(value, maxLength, controls = LINE_CONTROLS) {
  if (typeof value !== "string") return "";
  return value.replace(controls, " ").trim().slice(0, maxLength);
}

/** An in-app route like ``/workspace/realtime/<id>`` — never a URL. */
function sanitizeAppRoute(value) {
  if (typeof value !== "string") return null;
  const route = value.trim();
  if (
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.includes("\\") ||
    route.length > MAX_ROUTE_LENGTH ||
    HAS_CONTROL.test(route)
  ) {
    return null;
  }
  return route;
}

function normalizeNotificationPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = cleanText(raw.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  return {
    title,
    body: cleanText(raw.body, MAX_BODY_LENGTH, BODY_CONTROLS),
    tag: cleanText(raw.tag, MAX_TAG_LENGTH) || null,
    href: sanitizeAppRoute(raw.href),
    threadId: cleanText(raw.threadId, MAX_TAG_LENGTH) || null,
    silent: raw.silent === true,
  };
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return true;
}

/**
 * @param {object} deps
 * @param {typeof import("electron").Notification} deps.Notification
 * @param {() => import("electron").BrowserWindow | null} deps.getMainWindow
 * @param {(contents: import("electron").WebContents) => import("electron").BrowserWindow | null} [deps.windowForContents]
 * @param {(contents: import("electron").WebContents) => boolean} [deps.isTrustedSender]
 */
function createAttentionNotifications({
  Notification,
  getMainWindow,
  windowForContents = () => null,
  isTrustedSender = () => true,
}) {
  const live = new Map();
  let sequence = 0;

  const forget = (key, note) => {
    if (live.get(key) === note) live.delete(key);
  };

  const targetWindow = (sender) => {
    let owner = null;
    try {
      owner =
        sender && !sender.isDestroyed() ? windowForContents(sender) : null;
    } catch {
      owner = null;
    }
    if (owner && !owner.isDestroyed()) return owner;
    return getMainWindow();
  };

  function isSupported() {
    try {
      return Boolean(Notification?.isSupported());
    } catch {
      return false;
    }
  }

  function show(rawPayload, sender = null) {
    const payload = normalizeNotificationPayload(rawPayload);
    if (!payload) return { ok: false, reason: "invalid" };
    if (!isSupported()) return { ok: false, reason: "unsupported" };

    const key = payload.tag || `echo-notification-${++sequence}`;
    const previous = live.get(key);
    if (previous) {
      live.delete(key);
      try {
        previous.close();
      } catch {
        /* already gone */
      }
    }

    const note = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent,
    });
    note.on("click", () => {
      forget(key, note);
      const win = targetWindow(sender);
      if (!focusWindow(win)) return;
      win.webContents.send("notification:clicked", {
        href: payload.href,
        threadId: payload.threadId,
        tag: payload.tag,
      });
    });
    note.on("close", () => forget(key, note));
    note.on("failed", () => forget(key, note));

    live.set(key, note);
    while (live.size > MAX_LIVE_NOTIFICATIONS) {
      const oldest = live.keys().next().value;
      live.delete(oldest);
    }
    note.show();
    return { ok: true, id: key };
  }

  function registerIpc(ipcMain) {
    ipcMain.handle("notifications:isSupported", () => isSupported());
    ipcMain.handle("notifications:show", (event, payload) => {
      if (!isTrustedSender(event.sender)) {
        return { ok: false, reason: "forbidden" };
      }
      return show(payload, event.sender);
    });
  }

  return { isSupported, show, registerIpc, liveCount: () => live.size };
}

module.exports = {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  createAttentionNotifications,
  normalizeNotificationPayload,
  sanitizeAppRoute,
};
