/**
 * The browser side of Chrome extensions that Electron does not provide:
 * toolbar actions (icon, badge, popup), context-menu items, notifications,
 * side panels, extension windows and a tabs API that knows which browser
 * tab is active. extension-preload.cjs forwards the extensions' calls
 * here; the browser UI reads action state through the extensions:* IPC.
 */
const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  ipcMain,
  nativeImage,
  screen,
  webContents: allWebContents,
} = require("electron");

const compat = require("./extension-compat.cjs");

const PRELOAD = path.join(__dirname, "extension-preload.cjs");
const { WINDOW_ID, WINDOW_ID_CURRENT } = compat;
const EXTENSION_WINDOW_BASE = 1000;
const SIDE_PANEL_WIDTH = 380;
// The natural size of a popup page laid out in a tiny window.
const MEASURE_PAGE = `(() => {
  const root = document.documentElement;
  const body = document.body;
  let width = root.scrollWidth;
  let height = root.scrollHeight;
  if (body) {
    const box = body.getBoundingClientRect();
    const style = getComputedStyle(body);
    width = Math.max(width, Math.ceil(box.right + parseFloat(style.marginRight || "0")));
    height = Math.max(height, Math.ceil(box.bottom + parseFloat(style.marginBottom || "0")));
  }
  return { width, height };
})()`;

function createExtensionHost({
  session,
  getMainWindow,
  getActiveTab,
  openUrlInTab,
  sendToRenderer,
  readRegistry,
  writeRegistry,
}) {
  const extensions = session.extensions ?? session;
  const actionState = new Map(); // id → { global, tabs: Map<tabId, {}> }
  const iconCache = new Map();
  const anchors = new Map(); // id → last toolbar button rect
  const sidePanels = new Map(); // id → { behavior, options, win }
  const notifications = new Map(); // `${id}:${notificationId}` → Notification
  const extensionWindows = new Map(); // window id → { win, extensionId }
  const hookedWorkers = new Set();
  const favicons = new Map();
  let popup = null;
  let lastPopupClose = { extensionId: null, at: 0 };
  let lastActiveTabId = null;
  let downloadSeq = 0;
  let notificationSeq = 0;

  // ── context menus, kept across restarts like Chrome's ──
  const menusFile = () =>
    path.join(app.getPath("userData"), "extension-menus.json");
  const menus = new Map(); // id → Map<itemId, item>
  try {
    const saved = JSON.parse(fs.readFileSync(menusFile(), "utf8"));
    for (const [id, items] of Object.entries(saved))
      menus.set(id, new Map(items.map((item) => [item.id, item])));
  } catch {
    /* none yet */
  }
  let menusTimer = null;
  const saveMenus = () => {
    clearTimeout(menusTimer);
    menusTimer = setTimeout(() => {
      const out = {};
      for (const [id, items] of menus) out[id] = [...items.values()];
      fs.promises
        .writeFile(menusFile(), JSON.stringify(out))
        .catch(() => {});
    }, 200);
  };

  // ── helpers ──
  const getExtension = (id) => {
    try {
      return extensions.getExtension(id) || null;
    } catch {
      return null;
    }
  };
  const extensionBase = (id) => `chrome-extension://${id}/`;
  // Extensions pass page paths relative to their own root.
  const extensionUrl = (id, value) =>
    new URL(String(value ?? ""), extensionBase(id)).href;
  /** A file inside the extension's folder, never outside it. */
  const extensionFile = (ext, relative) => {
    if (!ext || typeof relative !== "string") return null;
    const root = path.resolve(ext.path);
    const clean = relative.replace(/^chrome-extension:\/\/[^/]+\//, "");
    const file = path.resolve(root, clean.replace(/^[/\\]+/, ""));
    return file.startsWith(root + path.sep) ? file : null;
  };
  const localeMessages = new Map();
  /** Resolve a manifest "__MSG_name__" string from _locales. */
  const localize = (ext, text) => {
    const m = /^__MSG_(\w+)__$/.exec(String(text ?? ""));
    if (!m || !ext) return text;
    if (!localeMessages.has(ext.id)) {
      const wanted = [
        app.getLocale().replace("-", "_"),
        app.getLocale().split("-")[0],
        ext.manifest?.default_locale,
        "en",
      ].filter(Boolean);
      let messages = {};
      for (const locale of wanted) {
        try {
          messages = JSON.parse(
            fs.readFileSync(
              path.join(ext.path, "_locales", locale, "messages.json"),
              "utf8",
            ),
          );
          break;
        } catch {
          /* try the next locale */
        }
      }
      const lower = {};
      for (const [key, value] of Object.entries(messages))
        lower[key.toLowerCase()] = value?.message;
      localeMessages.set(ext.id, lower);
    }
    return localeMessages.get(ext.id)[m[1].toLowerCase()] || ext.name;
  };
  const imageFileDataUrl = (file) => {
    if (!file) return null;
    try {
      if (/\.svg$/i.test(file))
        return `data:image/svg+xml;base64,${fs.readFileSync(file).toString("base64")}`;
      const image = nativeImage.createFromPath(file);
      return image.isEmpty() ? null : image.toDataURL();
    } catch {
      return null;
    }
  };
  const iconPathDataUrl = (ext, iconPath) => {
    if (!iconPath) return null;
    const pick =
      typeof iconPath === "string"
        ? iconPath
        : compat.pickIconPath({ icons: iconPath });
    return imageFileDataUrl(extensionFile(ext, pick));
  };
  const defaultIcon = (ext) => {
    if (!iconCache.has(ext.id))
      iconCache.set(
        ext.id,
        imageFileDataUrl(extensionFile(ext, compat.pickIconPath(ext.manifest))),
      );
    return iconCache.get(ext.id);
  };
  const optionsPage = (manifest = {}) =>
    manifest.options_ui?.page || manifest.options_page || null;

  // ── tabs ──
  const mainWindow = () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  };
  const isBrowserTab = (wc) => {
    const main = mainWindow();
    return Boolean(
      main &&
        wc &&
        !wc.isDestroyed() &&
        wc.getType() === "webview" &&
        wc.session === session &&
        wc.hostWebContents?.id === main.webContents.id,
    );
  };
  const browserTabs = () =>
    allWebContents
      .getAllWebContents()
      .filter(isBrowserTab)
      .sort((a, b) => a.id - b.id);
  const activeTabId = () => {
    const active = getActiveTab();
    return active && isBrowserTab(active) ? active.id : null;
  };
  const tabObject = (wc, index, activeId = activeTabId()) => {
    const active = wc.id === activeId;
    return {
      id: wc.id,
      index,
      windowId: WINDOW_ID,
      active,
      highlighted: active,
      selected: active,
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      url: wc.getURL(),
      title: wc.getTitle(),
      favIconUrl: favicons.get(wc.id),
      status: wc.isLoading() ? "loading" : "complete",
      audible: wc.isCurrentlyAudible(),
      mutedInfo: { muted: wc.isAudioMuted() },
    };
  };
  const allTabs = () => {
    const activeId = activeTabId();
    return browserTabs().map((wc, index) => tabObject(wc, index, activeId));
  };
  const tabById = (id) => allTabs().find((tab) => tab.id === id) || null;
  const tabContents = (id) => {
    const target = id == null ? getActiveTab() : allWebContents.fromId(id);
    return isBrowserTab(target) ? target : null;
  };

  // ── events to extension pages and service workers ──
  const runningWorker = (scope) => {
    for (const [versionId, info] of Object.entries(
      session.serviceWorkers.getAllRunning(),
    )) {
      if (info.scope === scope)
        return session.serviceWorkers.getWorkerFromVersionID(Number(versionId));
    }
    return null;
  };
  async function dispatch(extensionId, name, payload, { wake = false } = {}) {
    const scope = extensionBase(extensionId);
    for (const wc of allWebContents.getAllWebContents()) {
      if (wc.isDestroyed() || wc.session !== session) continue;
      if (wc.getURL().startsWith(scope)) wc.send("echo-ext:event", name, payload);
    }
    let worker = runningWorker(scope);
    const ext = getExtension(extensionId);
    if (!worker && wake && ext?.manifest?.background?.service_worker) {
      try {
        worker = await Promise.race([
          session.serviceWorkers.startWorkerForScope(scope),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("worker start timed out")), 5000),
          ),
        ]);
        hookWorker(worker.versionId);
      } catch {
        worker = null;
      }
    }
    if (worker && !worker.isDestroyed?.()) worker.send("echo-ext:event", name, payload);
  }
  const broadcast = (name, payload) => {
    for (const ext of extensions.getAllExtensions()) dispatch(ext.id, name, payload);
  };

  // ── toolbar action ──
  let notifyTimer = null;
  const notifyActions = () => {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(
      () => sendToRenderer("browser:extension-actions-changed"),
      50,
    );
  };
  const setAction = (id, tabId, patch) => {
    const state = actionState.get(id) || { global: {}, tabs: new Map() };
    actionState.set(id, state);
    if (typeof tabId === "number") {
      state.tabs.set(tabId, { ...(state.tabs.get(tabId) || {}), ...patch });
    } else Object.assign(state.global, patch);
    notifyActions();
  };
  const actionFor = (id, tabId) =>
    compat.effectiveAction(actionState.get(id), tabId ?? activeTabId());
  const declaredAction = (ext) => compat.manifestAction(ext?.manifest);
  const popupPath = (ext, tabId) => {
    const state = actionFor(ext.id, tabId);
    return state.popup !== undefined
      ? state.popup
      : declaredAction(ext)?.default_popup || "";
  };
  const sidePanel = (id) => {
    if (!sidePanels.has(id))
      sidePanels.set(id, {
        behavior: { openPanelOnActionClick: false },
        options: { enabled: true },
        win: null,
      });
    return sidePanels.get(id);
  };

  function actionInfo(ext, tabId, pinned) {
    const declared = declaredAction(ext);
    const state = actionFor(ext.id, tabId);
    const pageActionOnly = Boolean(
      ext.manifest?.page_action && !ext.manifest?.browser_action,
    );
    return {
      id: ext.id,
      name: ext.name,
      title: state.title ?? localize(ext, declared?.default_title) ?? ext.name,
      icon: state.icon ?? defaultIcon(ext),
      badgeText: state.badgeText || "",
      badgeColor: state.badgeColor,
      badgeTextColor: state.badgeTextColor,
      hasAction: Boolean(declared),
      hasPopup: Boolean(popupPath(ext, tabId)),
      hasOptions: Boolean(optionsPage(ext.manifest)),
      enabled: state.enabled ?? !pageActionOnly,
      pinned: pinned ?? Boolean(declared),
    };
  }

  function listActions(tabId) {
    const out = [];
    for (const entry of readRegistry()) {
      if (!entry.enabled) continue;
      const ext = getExtension(entry.id);
      if (ext) out.push(actionInfo(ext, tabId ?? null, entry.pinned));
    }
    return { ok: true, actions: out };
  }

  function setPinned(id, pinned) {
    const registry = readRegistry();
    const entry = registry.find((e) => e.id === id);
    if (!entry) return { ok: false, error: "extension not found" };
    entry.pinned = Boolean(pinned);
    writeRegistry(registry);
    notifyActions();
    return { ok: true };
  }

  const defaultAnchor = (main) => {
    const zoom = main.webContents.getZoomFactor() || 1;
    const { width } = main.getContentBounds();
    return { left: 0, top: 0, right: width / zoom - 12, bottom: 84 };
  };

  async function openPopup(id, page, anchor) {
    if (popup && !popup.win.isDestroyed()) {
      const same = popup.extensionId === id;
      popup.win.close();
      if (same) return { ok: true, closed: true };
    }
    // The click that blurred (and so closed) this popup must not reopen it.
    if (lastPopupClose.extensionId === id && Date.now() - lastPopupClose.at < 300)
      return { ok: true, closed: true };
    const main = mainWindow();
    if (!main) return { ok: false, error: "no window" };
    const url = extensionUrl(id, page);
    if (!url.startsWith(extensionBase(id)))
      return { ok: false, error: "popup outside the extension" };
    const win = new BrowserWindow({
      parent: main,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      width: 25,
      height: 25,
      backgroundColor: "#ffffff",
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        enablePreferredSizeMode: true,
      },
    });
    const entry = { win, extensionId: id };
    popup = entry;
    let size = { width: 25, height: 25 };
    const place = () => {
      if (win.isDestroyed() || main.isDestroyed()) return;
      win.setBounds(
        compat.popupBounds({
          anchor: anchor || defaultAnchor(main),
          contentBounds: main.getContentBounds(),
          zoom: main.webContents.getZoomFactor() || 1,
          size,
          workArea: screen.getDisplayMatching(main.getBounds()).workArea,
        }),
      );
    };
    const reveal = () => {
      if (win.isDestroyed() || win.isVisible()) return;
      place();
      win.show();
      win.focus();
    };
    let measured = false;
    win.webContents.on("preferred-size-changed", (_event, preferred) => {
      measured = true;
      size = preferred;
      place();
      reveal();
    });
    // Preferred-size events do not arrive in every environment (automated
    // runs); measure the laid-out page instead when none came.
    win.webContents.once("did-finish-load", () =>
      setTimeout(async () => {
        if (!measured && !win.isDestroyed()) {
          size = await win.webContents
            .executeJavaScript(MEASURE_PAGE, true)
            .catch(() => size);
        }
        reveal();
      }, 150),
    );
    win.on("blur", () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.close();
    });
    win.on("closed", () => {
      if (popup === entry) popup = null;
      lastPopupClose = { extensionId: id, at: Date.now() };
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      openUrlInTab(target);
      return { action: "deny" };
    });
    win.webContents.on("context-menu", () =>
      Menu.buildFromTemplate([
        {
          label: "检查弹出内容",
          click: () => win.webContents.openDevTools({ mode: "detach" }),
        },
      ]).popup({ window: win }),
    );
    win.loadURL(url).catch(() => {});
    return { ok: true, opened: "popup" };
  }

  // ── side panel ──
  function placeSidePanel(win) {
    const main = mainWindow();
    if (!main || win.isDestroyed()) return;
    const bounds = main.getContentBounds();
    win.setBounds({
      x: bounds.x + bounds.width - SIDE_PANEL_WIDTH,
      y: bounds.y,
      width: SIDE_PANEL_WIDTH,
      height: bounds.height,
    });
  }

  function toggleSidePanel(id, want = null) {
    const panel = sidePanel(id);
    if (panel.win && !panel.win.isDestroyed()) {
      if (want === true) panel.win.focus();
      else panel.win.close();
      return { ok: true };
    }
    if (want === false) return { ok: true };
    const ext = getExtension(id);
    const page =
      panel.options.path || ext?.manifest?.side_panel?.default_path || "";
    const main = mainWindow();
    if (!ext || !page || !main || panel.options.enabled === false)
      return { ok: false, error: "no side panel" };
    const win = new BrowserWindow({
      parent: main,
      title: ext.name,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: { session, sandbox: true, contextIsolation: true },
    });
    panel.win = win;
    placeSidePanel(win);
    const follow = () => placeSidePanel(win);
    main.on("move", follow);
    main.on("resize", follow);
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      main.off("move", follow);
      main.off("resize", follow);
      if (panel.win === win) panel.win = null;
      dispatch(id, "sidePanel.onClosed", [{ path: page, windowId: WINDOW_ID }]);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      openUrlInTab(url);
      return { action: "deny" };
    });
    win.loadURL(extensionUrl(id, page)).catch(() => {});
    dispatch(id, "sidePanel.onOpened", [{ path: page, windowId: WINDOW_ID }]);
    return { ok: true, opened: "sidePanel" };
  }

  async function clickAction(id, tabId, anchor) {
    const ext = getExtension(id);
    if (!ext) return { ok: false, error: "extension not loaded" };
    if (anchor) anchors.set(id, anchor);
    const target = tabId ?? activeTabId();
    const state = actionInfo(ext, target);
    if (!state.enabled) return { ok: false, error: "disabled for this tab" };
    const page = popupPath(ext, target);
    if (page) return openPopup(id, page, anchor);
    if (sidePanel(id).behavior.openPanelOnActionClick) return toggleSidePanel(id);
    const contents = tabContents(target);
    const tab = contents ? tabById(contents.id) : null;
    void dispatch(id, "action.onClicked", [tab], { wake: true });
    return { ok: true, dispatched: true };
  }

  function openOptions(id) {
    const ext = getExtension(id);
    const page = optionsPage(ext?.manifest);
    if (!page) return { ok: false, error: "no options page" };
    openUrlInTab(extensionUrl(id, page));
    return { ok: true };
  }

  // ── context menus ──
  const menuIcon = (ext) => {
    const data = defaultIcon(ext);
    if (!data) return undefined;
    const image = nativeImage.createFromDataURL(data);
    return image.isEmpty() ? undefined : image.resize({ width: 16, height: 16 });
  };
  function onMenuClick(id, item, params, contents) {
    const wasChecked = Boolean(item.checked);
    const items = menus.get(id);
    if (items && item.type === "checkbox") item.checked = !wasChecked;
    if (items && item.type === "radio") {
      for (const other of items.values()) {
        if (other.type === "radio" && (other.parentId ?? null) === (item.parentId ?? null))
          other.checked = false;
      }
      item.checked = true;
    }
    saveMenus();
    const target = contents && isBrowserTab(contents) ? contents : getActiveTab();
    const tab = target && isBrowserTab(target) ? tabById(target.id) : null;
    dispatch(
      id,
      "menus.onClicked",
      [compat.menuClickInfo(item, params, wasChecked), tab],
      { wake: true },
    );
  }

  /** Extension items for a right click in a browser tab. */
  function contextMenuItems(contents, params) {
    if (!contents || contents.session !== session || !menus.size) return [];
    const loaded = extensions
      .getAllExtensions()
      .filter((ext) => menus.get(ext.id)?.size)
      .map((ext) => ({
        id: ext.id,
        name: ext.name,
        icon: menuIcon(ext),
        items: [...menus.get(ext.id).values()],
      }));
    return compat.contextMenuTemplate(loaded, params, (id, item) =>
      onMenuClick(id, item, params, contents),
    );
  }

  /** Right click on a toolbar icon: the extension's action items + ours. */
  function showActionMenu(id, tabId) {
    const ext = getExtension(id);
    const main = mainWindow();
    if (!ext || !main) return { ok: false };
    const entry = readRegistry().find((e) => e.id === id);
    const pinned = actionInfo(ext, tabId, entry?.pinned).pinned;
    const contents = tabContents(tabId);
    const params = { pageURL: contents?.getURL() || "" };
    let own = compat.contextMenuTemplate(
      [{ id, name: ext.name, items: [...(menus.get(id)?.values() || [])] }],
      params,
      (extensionId, item) => onMenuClick(extensionId, item, params, contents),
      new Set(["all", "action", "browser_action", "page_action"]),
    );
    if (own.length === 1 && own[0].submenu && own[0].label === ext.name)
      own = own[0].submenu;
    const template = [
      { label: ext.name, enabled: false },
      { type: "separator" },
      ...own.map(({ icon: _icon, ...item }) => item),
      ...(own.length ? [{ type: "separator" }] : []),
      ...(optionsPage(ext.manifest)
        ? [{ label: "扩展选项", click: () => openOptions(id) }]
        : []),
      {
        label: pinned ? "从工具栏取消固定" : "固定到工具栏",
        click: () => setPinned(id, !pinned),
      },
      {
        label: "管理扩展…",
        click: () => sendToRenderer("browser:open-extensions"),
      },
    ];
    Menu.buildFromTemplate(template).popup({ window: main });
    return { ok: true };
  }

  // ── windows ──
  const mainWindowObject = (populate) => {
    const main = mainWindow();
    const bounds = main ? main.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
    return {
      id: WINDOW_ID,
      focused: Boolean(main?.isFocused() || (popup && !popup.win.isDestroyed())),
      top: bounds.y,
      left: bounds.x,
      width: bounds.width,
      height: bounds.height,
      incognito: false,
      type: "normal",
      state: !main
        ? "normal"
        : main.isFullScreen()
          ? "fullscreen"
          : main.isMinimized()
            ? "minimized"
            : main.isMaximized()
              ? "maximized"
              : "normal",
      alwaysOnTop: false,
      ...(populate ? { tabs: allTabs() } : {}),
    };
  };
  const extensionWindowObject = (windowId, populate) => {
    const { win } = extensionWindows.get(windowId);
    const bounds = win.getBounds();
    return {
      id: windowId,
      focused: win.isFocused(),
      top: bounds.y,
      left: bounds.x,
      width: bounds.width,
      height: bounds.height,
      incognito: false,
      type: "popup",
      state: "normal",
      alwaysOnTop: false,
      ...(populate
        ? {
            tabs: [
              {
                id: win.webContents.id,
                index: 0,
                windowId,
                active: true,
                url: win.webContents.getURL(),
                title: win.webContents.getTitle(),
              },
            ],
          }
        : {}),
    };
  };
  const windowOf = (windowId, populate) => {
    if (windowId == null || windowId === WINDOW_ID || windowId === WINDOW_ID_CURRENT)
      return mainWindowObject(populate);
    if (extensionWindows.has(windowId))
      return extensionWindowObject(windowId, populate);
    throw new Error(`No window with id: ${windowId}.`);
  };
  function createWindow(id, data = {}) {
    const urls = (Array.isArray(data.url) ? data.url : [data.url])
      .filter(Boolean)
      .map((url) => extensionUrl(id, url));
    if (data.type !== "popup" && data.type !== "panel") {
      for (const url of urls) openUrlInTab(url);
      if (!urls.length) openUrlInTab("echo://home");
      return mainWindowObject(true);
    }
    const ext = getExtension(id);
    const win = new BrowserWindow({
      width: Math.max(Number(data.width) || 500, 100),
      height: Math.max(Number(data.height) || 600, 100),
      ...(Number.isFinite(data.left) && Number.isFinite(data.top)
        ? { x: data.left, y: data.top }
        : {}),
      title: ext?.name || "",
      autoHideMenuBar: true,
      webPreferences: { session, sandbox: true, contextIsolation: true },
    });
    const windowId = EXTENSION_WINDOW_BASE + win.id;
    extensionWindows.set(windowId, { win, extensionId: id });
    win.webContents.setWindowOpenHandler(({ url }) => {
      openUrlInTab(url);
      return { action: "deny" };
    });
    win.on("closed", () => {
      extensionWindows.delete(windowId);
      dispatch(id, "windows.onRemoved", [windowId]);
    });
    if (urls[0]) win.loadURL(urls[0]).catch(() => {});
    return extensionWindowObject(windowId, true);
  }

  // ── calls from extensions ──
  const details = (args) => (args[0] && typeof args[0] === "object" ? args[0] : {});
  const optionalTabId = (value) => (typeof value === "number" ? value : undefined);

  const calls = {
    "action.setBadgeText": (id, _ctx, args) =>
      setAction(id, details(args).tabId, { badgeText: String(details(args).text ?? "") }),
    "action.getBadgeText": (id, _ctx, args) =>
      actionFor(id, details(args).tabId).badgeText ?? "",
    "action.setBadgeBackgroundColor": (id, _ctx, args) =>
      setAction(id, details(args).tabId, { badgeColor: compat.cssColor(details(args).color) }),
    "action.getBadgeBackgroundColor": (id, _ctx, args) =>
      actionFor(id, details(args).tabId).badgeColor ?? [0, 0, 0, 0],
    "action.setBadgeTextColor": (id, _ctx, args) =>
      setAction(id, details(args).tabId, { badgeTextColor: compat.cssColor(details(args).color) }),
    "action.getBadgeTextColor": (id, _ctx, args) =>
      actionFor(id, details(args).tabId).badgeTextColor ?? [255, 255, 255, 255],
    "action.setTitle": (id, _ctx, args) =>
      setAction(id, details(args).tabId, { title: String(details(args).title ?? "") }),
    "action.getTitle": (id, _ctx, args) => {
      const ext = getExtension(id);
      return actionFor(id, details(args).tabId).title ?? ext?.name ?? "";
    },
    "action.setPopup": (id, _ctx, args) =>
      setAction(id, details(args).tabId, { popup: String(details(args).popup ?? "") }),
    "action.getPopup": (id, _ctx, args) => {
      const page = popupPath(getExtension(id), details(args).tabId);
      return page ? extensionUrl(id, page) : "";
    },
    "action.setIcon": (id, _ctx, args) => {
      const { tabId, path: iconPath, imageData } = details(args);
      let icon = null;
      if (imageData?.width && Array.isArray(imageData.data)) {
        const rgba = Buffer.from(imageData.data);
        // Bitmaps are BGRA.
        for (let i = 0; i < rgba.length; i += 4) {
          const red = rgba[i];
          rgba[i] = rgba[i + 2];
          rgba[i + 2] = red;
        }
        icon = nativeImage
          .createFromBitmap(rgba, { width: imageData.width, height: imageData.height })
          .toDataURL();
      } else if (iconPath) icon = iconPathDataUrl(getExtension(id), iconPath);
      if (icon) setAction(id, tabId, { icon });
    },
    "action.enable": (id, _ctx, args) =>
      setAction(id, optionalTabId(args[0]), { enabled: true }),
    "action.disable": (id, _ctx, args) =>
      setAction(id, optionalTabId(args[0]), { enabled: false }),
    "action.isEnabled": (id, _ctx, args) =>
      actionFor(id, optionalTabId(args[0])).enabled !== false,
    "action.openPopup": (id) => {
      const ext = getExtension(id);
      const page = ext && popupPath(ext);
      return page ? openPopup(id, page, anchors.get(id)).then(() => undefined) : undefined;
    },

    "tabs.query": (_id, _ctx, args) =>
      allTabs().filter((tab) => compat.matchesTabQuery(tab, details(args))),
    "tabs.get": (_id, _ctx, args) => {
      const tab = tabById(args[0]);
      if (!tab) throw new Error(`No tab with id: ${args[0]}.`);
      return tab;
    },
    "tabs.getCurrent": (_id, ctx) =>
      ctx.contents && isBrowserTab(ctx.contents) ? tabById(ctx.contents.id) : undefined,
    "tabs.create": (id, _ctx, args) => {
      const props = details(args);
      const url = props.url ? extensionUrl(id, props.url) : "echo://home";
      const main = mainWindow();
      const attached = new Promise((resolve) => {
        if (!main) return resolve(null);
        const timer = setTimeout(() => resolve(null), 5000);
        main.webContents.once("did-attach-webview", (_event, guest) => {
          clearTimeout(timer);
          resolve(guest);
        });
      });
      openUrlInTab(url);
      return attached.then((guest) =>
        guest
          ? { ...(tabById(guest.id) || { id: guest.id }), pendingUrl: url }
          : { id: -1, index: -1, windowId: WINDOW_ID, active: true, pendingUrl: url },
      );
    },
    "tabs.update": (id, _ctx, args) => {
      const [tabId, props = {}] =
        typeof args[0] === "number" ? args : [undefined, args[0]];
      const contents = tabContents(tabId);
      if (!contents) throw new Error("No tab to update.");
      if (props.url) contents.loadURL(extensionUrl(id, props.url)).catch(() => {});
      if (typeof props.muted === "boolean") contents.setAudioMuted(props.muted);
      if (props.active || props.highlighted)
        sendToRenderer("browser:focus-webcontents", contents.id);
      return tabById(contents.id);
    },
    "tabs.remove": (_id, _ctx, args) => {
      for (const tabId of [].concat(args[0] ?? []))
        if (tabContents(tabId)) sendToRenderer("browser:close-webcontents", tabId);
    },
    "tabs.duplicate": (_id, _ctx, args) => {
      const contents = tabContents(args[0]);
      if (contents) openUrlInTab(contents.getURL());
    },
    "tabs.captureVisibleTab": async (_id, _ctx, args) => {
      const options = args.find((a) => a && typeof a === "object") || {};
      const contents = tabContents();
      if (!contents) throw new Error("No active tab.");
      const image = await contents.capturePage();
      return options.format === "png"
        ? image.toDataURL()
        : `data:image/jpeg;base64,${image.toJPEG(options.quality ?? 92).toString("base64")}`;
    },
    "tabs.goBack": (_id, _ctx, args) =>
      void tabContents(optionalTabId(args[0]))?.navigationHistory.goBack(),
    "tabs.goForward": (_id, _ctx, args) =>
      void tabContents(optionalTabId(args[0]))?.navigationHistory.goForward(),

    "windows.get": (_id, _ctx, args) => windowOf(args[0], args[1]?.populate),
    "windows.getCurrent": (_id, ctx, args) => {
      const own = [...extensionWindows].find(
        ([, entry]) => entry.win.webContents === ctx.contents,
      );
      return own
        ? extensionWindowObject(own[0], args[0]?.populate)
        : mainWindowObject(args[0]?.populate);
    },
    "windows.getAll": (_id, _ctx, args) => [
      mainWindowObject(args[0]?.populate),
      ...[...extensionWindows.keys()].map((windowId) =>
        extensionWindowObject(windowId, args[0]?.populate),
      ),
    ],
    "windows.create": (id, _ctx, args) => createWindow(id, details(args)),
    "windows.update": (_id, _ctx, args) => {
      const [windowId, info = {}] = args;
      const entry = extensionWindows.get(windowId);
      const win = entry ? entry.win : mainWindow();
      if (win && info.focused) win.focus();
      if (win && info.state === "minimized") win.minimize();
      if (win && info.state === "maximized") win.maximize();
      return windowOf(windowId);
    },
    "windows.remove": (_id, _ctx, args) => {
      const entry = extensionWindows.get(args[0]);
      if (!entry) throw new Error(`No window with id: ${args[0]}.`);
      entry.win.close();
    },

    "menus.create": (id, _ctx, args) => {
      const item = details(args);
      const items = menus.get(id) || new Map();
      menus.set(id, items);
      items.set(item.id, { ...item, type: item.type || "normal" });
      saveMenus();
    },
    "menus.update": (id, _ctx, args) => {
      const items = menus.get(id);
      const item = items?.get(args[0]);
      if (!item) throw new Error(`Cannot find menu item with id ${args[0]}`);
      Object.assign(item, args[1] || {});
      saveMenus();
    },
    "menus.remove": (id, _ctx, args) => {
      const items = menus.get(id);
      if (!items) return;
      const drop = (itemId) => {
        items.delete(itemId);
        for (const child of [...items.values()])
          if (child.parentId === itemId) drop(child.id);
      };
      drop(args[0]);
      saveMenus();
    },
    "menus.removeAll": (id) => {
      menus.delete(id);
      saveMenus();
    },

    "notifications.create": (id, _ctx, args) => {
      const notificationId = String(args[0] || `echo-${++notificationSeq}`);
      const options = args[1] || {};
      const key = `${id}:${notificationId}`;
      notifications.get(key)?.close();
      if (!Notification.isSupported()) return notificationId;
      const ext = getExtension(id);
      const iconUrl = String(options.iconUrl || "");
      const iconFile = iconUrl ? extensionFile(ext, iconUrl) : null;
      const icon = iconUrl.startsWith("data:")
        ? nativeImage.createFromDataURL(iconUrl)
        : iconFile && fs.existsSync(iconFile)
          ? nativeImage.createFromPath(iconFile)
          : undefined;
      const note = new Notification({
        title: String(options.title || ext?.name || ""),
        body: String(options.message || ""),
        icon,
        silent: Boolean(options.silent),
      });
      note.on("click", () =>
        dispatch(id, "notifications.onClicked", [notificationId], { wake: true }),
      );
      note.on("close", () => {
        notifications.delete(key);
        dispatch(id, "notifications.onClosed", [notificationId, true]);
      });
      notifications.set(key, note);
      note.show();
      return notificationId;
    },
    "notifications.update": (id, ctx, args) => {
      if (!notifications.has(`${id}:${args[0]}`)) return false;
      calls["notifications.create"](id, ctx, args);
      return true;
    },
    "notifications.clear": (id, _ctx, args) => {
      const note = notifications.get(`${id}:${args[0]}`);
      note?.close();
      return Boolean(note);
    },
    "notifications.getAll": (id) => {
      const out = {};
      for (const key of notifications.keys())
        if (key.startsWith(`${id}:`)) out[key.slice(id.length + 1)] = true;
      return out;
    },

    "sidePanel.setOptions": (id, _ctx, args) => {
      Object.assign(sidePanel(id).options, details(args));
    },
    "sidePanel.getOptions": (id) => ({ ...sidePanel(id).options }),
    "sidePanel.setPanelBehavior": (id, _ctx, args) => {
      Object.assign(sidePanel(id).behavior, details(args));
    },
    "sidePanel.getPanelBehavior": (id) => ({ ...sidePanel(id).behavior }),
    "sidePanel.open": (id) => void toggleSidePanel(id, true),
    "sidePanel.close": (id) => void toggleSidePanel(id, false),

    "downloads.download": (id, _ctx, args) => {
      session.downloadURL(extensionUrl(id, details(args).url));
      return ++downloadSeq;
    },
    "runtime.openOptionsPage": (id) => void openOptions(id),
  };

  function call(extensionId, ctx, method, args) {
    const fn = Object.hasOwn(calls, method) ? calls[method] : null;
    if (!fn) throw new Error(`${method} is not available in Echo`);
    return fn(extensionId, ctx, Array.isArray(args) ? args : []);
  }

  function hookWorker(versionId) {
    if (hookedWorkers.has(versionId)) return;
    const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!worker || !String(worker.scope).startsWith("chrome-extension://")) return;
    hookedWorkers.add(versionId);
    const extensionId = new URL(worker.scope).hostname;
    worker.ipc.handle("echo-ext:invoke", (_event, method, args) =>
      call(extensionId, { worker }, method, args),
    );
  }

  // ── tab events ──
  function watchTab(contents) {
    let created = false;
    const updated = (changeInfo) => {
      if (!isBrowserTab(contents)) return;
      const tab = tabById(contents.id);
      if (tab) broadcast("tabs.onUpdated", [contents.id, changeInfo, tab]);
    };
    contents.on("dom-ready", () => {
      if (created || !isBrowserTab(contents)) return;
      created = true;
      broadcast("tabs.onCreated", [tabById(contents.id)]);
    });
    contents.on("did-start-loading", () => updated({ status: "loading" }));
    contents.on("did-stop-loading", () => updated({ status: "complete" }));
    contents.on("did-navigate", (_event, url) => updated({ url }));
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) updated({ url });
    });
    contents.on("page-title-updated", (_event, title) => updated({ title }));
    contents.on("page-favicon-updated", (_event, urls) => {
      favicons.set(contents.id, urls[0]);
      updated({ favIconUrl: urls[0] });
    });
    const id = contents.id;
    contents.once("destroyed", () => {
      favicons.delete(id);
      for (const state of actionState.values()) state.tabs.delete(id);
      if (created)
        broadcast("tabs.onRemoved", [id, { windowId: WINDOW_ID, isWindowClosing: false }]);
    });
  }

  /** The browser UI switched tabs (bridge:setActiveTab). */
  function tabActivated(tabId) {
    if (tabId == null || tabId === lastActiveTabId) return;
    lastActiveTabId = tabId;
    broadcast("tabs.onActivated", [{ tabId, windowId: WINDOW_ID }]);
    notifyActions();
  }

  /** An extension was turned off or removed: drop what it left behind. */
  function forget(id, { purge = false } = {}) {
    if (popup?.extensionId === id && !popup.win.isDestroyed()) popup.win.close();
    const panel = sidePanels.get(id);
    if (panel?.win && !panel.win.isDestroyed()) panel.win.close();
    sidePanels.delete(id);
    for (const [windowId, entry] of extensionWindows)
      if (entry.extensionId === id && !entry.win.isDestroyed()) {
        entry.win.close();
        extensionWindows.delete(windowId);
      }
    for (const [key, note] of notifications)
      if (key.startsWith(`${id}:`)) note.close();
    actionState.delete(id);
    iconCache.delete(id);
    localeMessages.delete(id);
    anchors.delete(id);
    if (purge && menus.delete(id)) saveMenus();
    notifyActions();
  }

  function install() {
    session.registerPreloadScript({
      type: "frame",
      id: "echo-extension-compat",
      filePath: PRELOAD,
    });
    session.registerPreloadScript({
      type: "service-worker",
      id: "echo-extension-compat-worker",
      filePath: PRELOAD,
    });
    ipcMain.handle("echo-ext:invoke", (event, method, args) => {
      const url = event.senderFrame?.url || "";
      if (event.sender.session !== session || !url.startsWith("chrome-extension://"))
        throw new Error("not an extension page");
      const id = new URL(url).hostname;
      if (!getExtension(id)) throw new Error("extension not loaded");
      return call(id, { contents: event.sender }, method, args);
    });
    session.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
      if (runningStatus === "starting" || runningStatus === "running")
        hookWorker(versionId);
      else if (runningStatus === "stopped") hookedWorkers.delete(versionId);
    });
    for (const versionId of Object.keys(session.serviceWorkers.getAllRunning()))
      hookWorker(Number(versionId));
    app.on("web-contents-created", (_event, contents) => {
      if (contents.getType() === "webview") watchTab(contents);
    });
    extensions.on("extension-loaded", () => notifyActions());
    extensions.on("extension-unloaded", (_event, ext) => forget(ext.id));
  }

  return {
    install,
    listActions,
    clickAction,
    showActionMenu,
    setPinned,
    openOptions,
    contextMenuItems,
    tabActivated,
    forget,
  };
}

module.exports = { createExtensionHost };
