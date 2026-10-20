"use strict";

/** Write-only IPC: external pages and child frames never receive clipboard access. */
function registerClipboardWrite({ ipcMain, clipboard, isTrustedSender }) {
  ipcMain.handle("clipboard:writeText", (event, text) => {
    if (!isTrustedSender(event)) return { ok: false, error: "forbidden" };
    if (typeof text !== "string" || text.length > 4_000_000)
      return { ok: false, error: "invalid clipboard text" };
    try {
      clipboard.writeText(text);
      return { ok: true };
    } catch {
      return { ok: false, error: "Unable to copy text" };
    }
  });
}

function isTrustedClipboardFrame(event, { isAppContents, isAppURL, devURL }) {
  if (
    !isAppContents(event.sender) ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  const url = event.senderFrame?.url || "";
  if (isAppURL(url)) return true;
  try {
    const development = devURL ? new URL(devURL) : null;
    return Boolean(
      development &&
      ["http:", "https:"].includes(development.protocol) &&
      new URL(url).origin === development.origin,
    );
  } catch {
    return false;
  }
}

module.exports = { registerClipboardWrite, isTrustedClipboardFrame };
