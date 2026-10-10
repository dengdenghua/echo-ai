/**
 * Chrome extension APIs Electron leaves out — the toolbar action, context
 * menus, notifications, windows, side panel and most of tabs — filled in
 * for the extension pages and service workers of the browser profile.
 * Calls go to extension-host.cjs in the main process. Registered on the
 * browser session for frames and service workers alike; anything that is
 * not an extension (web pages, sites' own workers) gets nothing.
 */
const { contextBridge, ipcRenderer } = require("electron");

let href = "";
try {
  href = String(
    contextBridge.executeInMainWorld({
      func: () => String(globalThis.location?.href || ""),
    }),
  );
} catch {
  /* not a context this preload can reach */
}

if (href.startsWith("chrome-extension://")) {
  const bridge = {
    invoke: (method, args) => ipcRenderer.invoke("echo-ext:invoke", method, args),
    listen: (callback) => {
      ipcRenderer.on("echo-ext:event", (_event, name, payload) =>
        callback(name, payload),
      );
    },
  };
  try {
    contextBridge.executeInMainWorld({ func: installCompat, args: [bridge] });
  } catch (err) {
    console.warn("[echo] extension API shim failed:", err);
  }
}

// Runs in the extension's own world (serialized: self-contained only).
function installCompat(bridge) {
  const chrome = globalThis.chrome;
  if (!chrome?.runtime?.id) return;
  const manifest = chrome.runtime.getManifest?.() || {};
  const permissions = new Set(manifest.permissions || []);

  const events = new Map();
  const menuClicks = new Map();
  // A click can wake the service worker and arrive before its script has
  // added the listener; such events wait for it, as Chrome's do.
  const QUEUED = new Set([
    "action.onClicked",
    "menus.onClicked",
    "notifications.onClicked",
    "notifications.onClosed",
  ]);
  const pending = new Map();
  const deliver = (name, args) => {
    if (name === "menus.onClicked") {
      const onclick = menuClicks.get(args[0]?.menuItemId);
      if (onclick) {
        try {
          onclick(...args);
        } catch (err) {
          console.error(err);
        }
      }
    }
    for (const fn of [...(events.get(name) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const event = (name) => {
    const set = events.get(name) || new Set();
    events.set(name, set);
    return {
      addListener: (fn) => {
        set.add(fn);
        const queued = pending.get(name);
        if (!queued) return;
        pending.delete(name);
        setTimeout(() => {
          for (const item of queued)
            if (Date.now() - item.at < 10_000) deliver(name, item.args);
        }, 0);
      },
      removeListener: (fn) => void set.delete(fn),
      hasListener: (fn) => set.has(fn),
      hasListeners: () => set.size > 0,
    };
  };
  bridge.listen((name, payload) => {
    const args = Array.isArray(payload) ? payload : [payload];
    const handled =
      events.get(name)?.size ||
      (name === "menus.onClicked" && menuClicks.has(args[0]?.menuItemId));
    if (!handled && QUEUED.has(name)) {
      const queued = pending.get(name) || [];
      if (queued.length < 20) queued.push({ args, at: Date.now() });
      pending.set(name, queued);
      return;
    }
    deliver(name, args);
  });

  // Chrome APIs return a promise, or call back when the last argument is a
  // function.
  const settle = (promise, callback) => {
    if (typeof callback !== "function") return promise;
    promise.then(
      (value) => callback(value),
      (err) => {
        console.error(err);
        callback();
      },
    );
    return undefined;
  };
  const api =
    (method) =>
    (...args) => {
      const callback =
        typeof args[args.length - 1] === "function" ? args.pop() : undefined;
      return settle(bridge.invoke(method, args), callback);
    };
  const resolved = (value) => (callback) =>
    settle(Promise.resolve(value), callback);

  // ── toolbar action (MV3 action, MV2 browserAction / pageAction) ──
  const plainImage = (image) =>
    image && typeof image.width === "number" && image.data
      ? {
          width: image.width,
          height: image.height,
          data: Array.from(image.data),
        }
      : null;
  const iconDetails = (details = {}) => {
    const out = { tabId: details.tabId, path: details.path };
    const data = details.imageData;
    if (data?.data) out.imageData = plainImage(data);
    else if (data && typeof data === "object") {
      const sizes = Object.keys(data)
        .map(Number)
        .sort((a, b) => a - b);
      const size = sizes.find((n) => n >= 32) ?? sizes[sizes.length - 1];
      out.imageData = plainImage(data[size]);
    }
    return out;
  };
  const actionClicked = event("action.onClicked");
  const action = () => {
    const m = (name) => api(`action.${name}`);
    return {
      setBadgeText: m("setBadgeText"),
      getBadgeText: m("getBadgeText"),
      setBadgeBackgroundColor: m("setBadgeBackgroundColor"),
      getBadgeBackgroundColor: m("getBadgeBackgroundColor"),
      setBadgeTextColor: m("setBadgeTextColor"),
      getBadgeTextColor: m("getBadgeTextColor"),
      setTitle: m("setTitle"),
      getTitle: m("getTitle"),
      setPopup: m("setPopup"),
      getPopup: m("getPopup"),
      setIcon: (details, callback) =>
        settle(bridge.invoke("action.setIcon", [iconDetails(details)]), callback),
      enable: m("enable"),
      disable: m("disable"),
      show: m("enable"),
      hide: m("disable"),
      isEnabled: m("isEnabled"),
      openPopup: m("openPopup"),
      getUserSettings: resolved({ isOnToolbar: true }),
      onClicked: actionClicked,
      onUserSettingsChanged: event("action.onUserSettingsChanged"),
    };
  };
  if (manifest.manifest_version >= 3) chrome.action = action();
  else {
    if (manifest.browser_action) chrome.browserAction = action();
    if (manifest.page_action) chrome.pageAction = action();
  }

  // ── tabs ──
  const tabs = chrome.tabs || (chrome.tabs = {});
  for (const name of [
    "query",
    "get",
    "getCurrent",
    "create",
    "update",
    "remove",
    "duplicate",
    "captureVisibleTab",
    "goBack",
    "goForward",
  ]) {
    tabs[name] = api(`tabs.${name}`);
  }
  tabs.TAB_ID_NONE = -1;
  for (const name of ["onActivated", "onUpdated", "onRemoved", "onCreated"]) {
    tabs[name] = event(`tabs.${name}`);
  }

  // ── windows ──
  chrome.windows = {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    get: api("windows.get"),
    getCurrent: api("windows.getCurrent"),
    getLastFocused: api("windows.getCurrent"),
    getAll: api("windows.getAll"),
    create: api("windows.create"),
    update: api("windows.update"),
    remove: api("windows.remove"),
    onCreated: event("windows.onCreated"),
    onRemoved: event("windows.onRemoved"),
    onFocusChanged: event("windows.onFocusChanged"),
    onBoundsChanged: event("windows.onBoundsChanged"),
  };

  // ── context menus ──
  if (permissions.has("contextMenus")) {
    let autoId = 0;
    const strip = (props = {}) => {
      const { onclick, ...rest } = props;
      return [rest, onclick];
    };
    chrome.contextMenus = {
      ACTION_MENU_TOP_LEVEL_LIMIT: 6,
      create(props = {}, callback) {
        const id = props.id ?? `echo-auto-${++autoId}`;
        const [rest, onclick] = strip(props);
        if (typeof onclick === "function") menuClicks.set(id, onclick);
        settle(bridge.invoke("menus.create", [{ ...rest, id }]), callback);
        return id;
      },
      update(id, props = {}, callback) {
        const [rest, onclick] = strip(props);
        if (typeof onclick === "function") menuClicks.set(id, onclick);
        return settle(bridge.invoke("menus.update", [id, rest]), callback);
      },
      remove(id, callback) {
        menuClicks.delete(id);
        return settle(bridge.invoke("menus.remove", [id]), callback);
      },
      removeAll(callback) {
        menuClicks.clear();
        return settle(bridge.invoke("menus.removeAll", []), callback);
      },
      onClicked: event("menus.onClicked"),
      onShown: event("menus.onShown"),
      onHidden: event("menus.onHidden"),
    };
  }

  // ── notifications ──
  if (permissions.has("notifications")) {
    chrome.notifications = {
      TemplateType: {
        BASIC: "basic",
        IMAGE: "image",
        LIST: "list",
        PROGRESS: "progress",
      },
      PermissionLevel: { GRANTED: "granted", DENIED: "denied" },
      create(...args) {
        const callback =
          typeof args[args.length - 1] === "function" ? args.pop() : undefined;
        const [id, options] =
          args.length > 1 ? [args[0] || "", args[1]] : ["", args[0]];
        return settle(
          bridge.invoke("notifications.create", [id, options]),
          callback,
        );
      },
      update: api("notifications.update"),
      clear: api("notifications.clear"),
      getAll: api("notifications.getAll"),
      getPermissionLevel: resolved("granted"),
      onClicked: event("notifications.onClicked"),
      onClosed: event("notifications.onClosed"),
      onButtonClicked: event("notifications.onButtonClicked"),
      onPermissionLevelChanged: event("notifications.onPermissionLevelChanged"),
      onShowSettings: event("notifications.onShowSettings"),
    };
  }

  // ── side panel ──
  if (permissions.has("sidePanel")) {
    chrome.sidePanel = {
      setOptions: api("sidePanel.setOptions"),
      getOptions: api("sidePanel.getOptions"),
      setPanelBehavior: api("sidePanel.setPanelBehavior"),
      getPanelBehavior: api("sidePanel.getPanelBehavior"),
      open: api("sidePanel.open"),
      close: api("sidePanel.close"),
      onOpened: event("sidePanel.onOpened"),
      onClosed: event("sidePanel.onClosed"),
    };
  }

  // ── downloads ──
  if (permissions.has("downloads") && !chrome.downloads) {
    chrome.downloads = {
      download: api("downloads.download"),
      search: (_query, callback) => settle(Promise.resolve([]), callback),
      showDefaultFolder: () => {},
      onCreated: event("downloads.onCreated"),
      onChanged: event("downloads.onChanged"),
      onErased: event("downloads.onErased"),
      onDeterminingFilename: event("downloads.onDeterminingFilename"),
    };
  }

  // ── permissions: everything declared is granted ──
  if (!chrome.permissions) {
    const declared = new Set([
      ...(manifest.permissions || []),
      ...(manifest.optional_permissions || []),
    ]);
    const origins = [
      ...(manifest.host_permissions || []),
      ...(manifest.optional_host_permissions || []),
    ];
    chrome.permissions = {
      contains: (wanted = {}, callback) =>
        settle(
          Promise.resolve(
            (wanted.permissions || []).every((p) => declared.has(p)) &&
              (!(wanted.origins || []).length || origins.length > 0),
          ),
          callback,
        ),
      getAll: resolved({
        permissions: [...(manifest.permissions || [])],
        origins: [...(manifest.host_permissions || [])],
      }),
      request: (_wanted, callback) => settle(Promise.resolve(true), callback),
      remove: (_wanted, callback) => settle(Promise.resolve(false), callback),
      onAdded: event("permissions.onAdded"),
      onRemoved: event("permissions.onRemoved"),
    };
  }

  // ── commands: declared, never fired (no global shortcuts) ──
  if (!chrome.commands) {
    chrome.commands = {
      getAll: resolved(
        Object.entries(manifest.commands || {}).map(([name, command]) => ({
          name,
          description: command?.description || "",
          shortcut: "",
        })),
      ),
      onCommand: event("commands.onCommand"),
    };
  }

  if (chrome.runtime && typeof chrome.runtime.openOptionsPage !== "function") {
    chrome.runtime.openOptionsPage = api("runtime.openOptionsPage");
  }
}
