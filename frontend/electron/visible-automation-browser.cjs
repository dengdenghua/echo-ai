"use strict";

/** Cold-start a visible, sandboxed browser owned by this Echo window.
 * Existing selected tabs keep priority until a dedicated task window exists.
 * No renderer preload, Node access, arbitrary target ID or external launcher.
 */
function createVisibleAutomationBrowser({
  BrowserWindow,
  getSelectedTarget,
  getOwner,
  partition,
  icon,
}) {
  let window = null;
  const canOpenBrowser = () => {
    const owner = getOwner();
    return Boolean(owner && !owner.isDestroyed());
  };
  const getTarget = () => {
    if (window && !window.isDestroyed()) return window.webContents;
    return getSelectedTarget();
  };
  const ensureTarget = () => {
    const current = getTarget();
    if (current) return current;
    if (!canOpenBrowser()) throw new Error("Echo window is unavailable");
    const owner = getOwner();
    const created = new BrowserWindow({
      parent: owner,
      width: 1120,
      height: 800,
      title: "Echo · Browser",
      icon,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    window = created;
    const webURL = (value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    };
    const guardNavigation = (event, url) => {
      if (!webURL(url)) event.preventDefault();
    };
    created.webContents.on("will-navigate", guardNavigation);
    created.webContents.on("will-redirect", guardNavigation);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const close = () => {
      if (!created.isDestroyed()) created.close();
    };
    owner.once("closed", close);
    created.once("closed", () => {
      owner.removeListener("closed", close);
      if (window === created) window = null;
    });
    return created.webContents;
  };
  return { getTarget, ensureTarget, canOpenBrowser };
}

module.exports = { createVisibleAutomationBrowser };
