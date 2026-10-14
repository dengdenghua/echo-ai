"use strict";

const { WebContentsView } = require("electron");

/** One extension surface alongside the browser content, inside its window. */
function createEmbeddedSidePanel({
  session,
  getMainWindow,
  getActiveTab,
  getExtension,
  getOptions,
  openUrlInTab,
  notify,
  dispatch,
  windowId,
}) {
  let current = null;
  let rectangle = null;

  function state() {
    if (!current || current.view.webContents.isDestroyed()) return null;
    const active = getActiveTab();
    if (active && active.session !== session) return null;
    if (current.tabId != null && current.tabId !== active?.id) return null;
    const options = getOptions(current.id, active?.id);
    if (options.enabled === false) return null;
    return { id: current.id, name: current.name, path: current.path };
  }

  function place() {
    if (!current || current.view.webContents.isDestroyed()) return;
    const main = getMainWindow();
    const mainUrl =
      main && !main.isDestroyed()
        ? new URL(main.webContents.getURL() || "about:blank")
        : null;
    const route = mainUrl?.hash.startsWith("#/")
      ? mainUrl.hash.slice(1).split(/[?#]/)[0]
      : mainUrl?.pathname;
    const inBrowser = route?.replace(/\/$/, "") === "/browser";
    const visible = state() && rectangle && inBrowser;
    current.view.setVisible(Boolean(visible));
    if (!visible) return;
    const zoom = main.webContents.getZoomFactor();
    const [width, height] = main.getContentSize();
    const x = Math.max(0, Math.min(width, Math.round(rectangle.left * zoom)));
    const y = Math.max(0, Math.min(height, Math.round(rectangle.top * zoom)));
    current.view.setBounds({
      x,
      y,
      width: Math.max(
        0,
        Math.min(width - x, Math.round(rectangle.width * zoom)),
      ),
      height: Math.max(
        0,
        Math.min(height - y, Math.round(rectangle.height * zoom)),
      ),
    });
  }

  function setBounds(bounds) {
    if (
      bounds !== null &&
      (!bounds ||
        ![bounds.left, bounds.top, bounds.width, bounds.height].every(
          Number.isFinite,
        ) ||
        bounds.width <= 0 ||
        bounds.height <= 0)
    )
      throw new Error("Invalid extension side panel bounds");
    rectangle = bounds;
    place();
  }

  function refresh() {
    place();
    notify(state());
  }

  async function optionsChanged(id) {
    if (current?.id === id) {
      const options = getOptions(id, current.tabId ?? getActiveTab()?.id);
      const page =
        options.path || getExtension(id)?.manifest?.side_panel?.default_path;
      if (options.enabled !== false && page !== current.path)
        return open(id, { tabId: current.tabId });
    }
    refresh();
  }

  function sync() {
    if (!current) return;
    void optionsChanged(current.id).catch((error) =>
      console.warn("[echo] extension side panel update failed:", error.message),
    );
  }

  function forgetTab(tabId) {
    if (current?.tabId === tabId) close();
    else sync();
  }

  function close(id = current?.id) {
    if (!current || current.id !== id) return;
    const entry = current;
    current = null;
    rectangle = null;
    entry.main.off("resize", place);
    entry.main.off("closed", closeOnWindow);
    entry.main.webContents.off("did-start-navigation", hideOnNavigation);
    entry.main.webContents.off("did-navigate", place);
    entry.main.webContents.off("did-navigate-in-page", place);
    entry.main.webContents.off("render-process-gone", hide);
    if (!entry.main.isDestroyed())
      entry.main.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    notify(null);
    void dispatch(entry.id, "sidePanel.onClosed", [
      { path: entry.path, windowId },
    ]);
  }

  function closeOnWindow() {
    close();
  }

  function hide() {
    rectangle = null;
    place();
  }

  function hideOnNavigation(event, _url, isInPlace, isMainFrame) {
    // A new document cannot reliably run React cleanup before its IPC bridge
    // is destroyed. It must explicitly place the view again after loading.
    if (
      (event.isMainFrame ?? isMainFrame) &&
      !(event.isSameDocument ?? isInPlace)
    )
      hide();
  }

  async function open(id, { tabId = null } = {}) {
    const extension = getExtension(id);
    const main = getMainWindow();
    const options = getOptions(id, tabId ?? getActiveTab()?.id);
    const page = options.path || extension?.manifest?.side_panel?.default_path;
    if (
      !extension ||
      !main ||
      main.isDestroyed() ||
      !page ||
      options.enabled === false
    )
      throw new Error("No enabled side panel");
    if (!extension.manifest?.permissions?.includes("sidePanel"))
      throw new Error("Extension has no sidePanel permission");
    const url = new URL(page, `chrome-extension://${id}/`);
    if (url.protocol !== "chrome-extension:" || url.hostname !== id)
      throw new Error("Side panel must be a page in its own extension");
    if (
      current?.id === id &&
      current.path === page &&
      current.tabId === tabId
    ) {
      refresh();
      if (rectangle) current.view.webContents.focus();
      return { ok: true, opened: "sidePanel" };
    }
    close();
    const view = new WebContentsView({
      webPreferences: { session, sandbox: true, contextIsolation: true },
    });
    const entry = { id, name: extension.name, path: page, tabId, view, main };
    current = entry;
    main.contentView.addChildView(view);
    view.setVisible(false);
    main.on("resize", place);
    main.once("closed", closeOnWindow);
    main.webContents.on("did-start-navigation", hideOnNavigation);
    main.webContents.on("did-navigate", place);
    main.webContents.on("did-navigate-in-page", place);
    main.webContents.on("render-process-gone", hide);
    view.webContents.setWindowOpenHandler(({ url }) => {
      openUrlInTab(url);
      return { action: "deny" };
    });
    const guardNavigation = (event, value) => {
      const target = new URL(event.url ?? value);
      if (target.protocol !== "chrome-extension:" || target.hostname !== id)
        event.preventDefault();
    };
    view.webContents.on("will-navigate", guardNavigation);
    view.webContents.on("will-redirect", guardNavigation);
    refresh();
    try {
      await view.webContents.loadURL(url.href);
      if (current !== entry)
        return { ok: false, error: "Side panel was closed" };
      refresh();
      void dispatch(id, "sidePanel.onOpened", [{ path: page, windowId }]);
      return { ok: true, opened: "sidePanel" };
    } catch (error) {
      if (current === entry) close(id);
      throw error;
    }
  }

  async function toggle(id, want = null, options = {}) {
    if (current?.id === id && want !== true) {
      close(id);
      return { ok: true };
    }
    if (want === false) return { ok: true };
    return open(id, options);
  }

  return {
    state,
    setBounds,
    refresh,
    optionsChanged,
    sync,
    forgetTab,
    close,
    toggle,
    dispose: () => close(),
  };
}

module.exports = { createEmbeddedSidePanel };
