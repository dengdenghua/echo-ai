/**
 * Pure helpers behind extension-host.cjs: Chrome match patterns, tab
 * queries, extension context-menu trees and toolbar action state. No
 * Electron here, so it is unit tested directly.
 */

/** Chrome's single window: every browser tab lives in it. */
const WINDOW_ID = 1;
const WINDOW_ID_CURRENT = -2;

function escapeRegExp(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Chrome match pattern ("*://*.example.com/*", "<all_urls>") → test. */
function matchPattern(pattern, url) {
  if (typeof pattern !== "string" || typeof url !== "string") return false;
  if (pattern === "<all_urls>")
    return /^(https?|wss?|ftp|file|data):/i.test(url);
  const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
  if (!m) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, rawPath = "/*"] = m;
  const urlScheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (scheme === "*" ? !["http", "https"].includes(urlScheme) : scheme.toLowerCase() !== urlScheme)
    return false;
  if (urlScheme !== "file" && host !== "*") {
    const hostname = parsed.hostname.toLowerCase();
    const want = host.toLowerCase().replace(/:\d+$/, "");
    if (want.startsWith("*.")) {
      const base = want.slice(2);
      if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
    } else if (hostname !== want) return false;
  }
  const pathRe = new RegExp(
    `^${rawPath.split("*").map(escapeRegExp).join(".*")}$`,
  );
  return pathRe.test(parsed.pathname + parsed.search);
}

/** tabs.query's title filter: "*" matches anything. */
function globMatch(glob, text) {
  const re = new RegExp(
    `^${String(glob).split("*").map(escapeRegExp).join(".*")}$`,
    "i",
  );
  return re.test(String(text ?? ""));
}

/** Whether a tab (shaped like chrome.tabs.Tab) passes a tabs.query filter. */
function matchesTabQuery(tab, query = {}) {
  const q = query || {};
  const flags = [
    ["active", tab.active],
    ["highlighted", tab.highlighted],
    ["pinned", tab.pinned],
    ["audible", tab.audible],
    ["discarded", tab.discarded],
    ["autoDiscardable", tab.autoDiscardable],
    ["muted", tab.mutedInfo?.muted ?? false],
  ];
  for (const [key, value] of flags) {
    if (q[key] != null && Boolean(q[key]) !== Boolean(value)) return false;
  }
  if (q.currentWindow === false || q.lastFocusedWindow === false) return false;
  if (
    q.windowId != null &&
    q.windowId !== WINDOW_ID_CURRENT &&
    q.windowId !== tab.windowId
  )
    return false;
  if (q.windowType && q.windowType !== "normal") return false;
  if (q.status && q.status !== tab.status) return false;
  if (q.index != null && q.index !== tab.index) return false;
  if (q.groupId != null && q.groupId !== -1) return false;
  if (q.title && !globMatch(q.title, tab.title)) return false;
  if (q.url) {
    const patterns = Array.isArray(q.url) ? q.url : [q.url];
    if (!patterns.some((p) => matchPattern(p, tab.url))) return false;
  }
  return true;
}

// ── context menus ──────────────────────────────────────────────

/** Menu contexts of a right click, from Electron's context-menu params. */
function clickContexts(params) {
  const contexts = new Set(["all"]);
  if (String(params.selectionText || "").trim()) contexts.add("selection");
  if (params.linkURL) contexts.add("link");
  if (params.isEditable) contexts.add("editable");
  if (["image", "video", "audio"].includes(params.mediaType))
    contexts.add(params.mediaType);
  if (contexts.size === 1)
    contexts.add(params.frameURL && params.frameURL !== params.pageURL ? "frame" : "page");
  return contexts;
}

function itemApplies(item, contexts, params) {
  if (item.visible === false) return false;
  const wanted = item.contexts?.length ? item.contexts : ["page"];
  if (!wanted.some((c) => contexts.has(c))) return false;
  if (item.documentUrlPatterns?.length) {
    const page = params.frameURL || params.pageURL || "";
    if (!item.documentUrlPatterns.some((p) => matchPattern(p, page)))
      return false;
  }
  if (item.targetUrlPatterns?.length) {
    const target = params.linkURL || params.srcURL;
    if (target && !item.targetUrlPatterns.some((p) => matchPattern(p, target)))
      return false;
  }
  return true;
}

function menuLabel(title, selection) {
  const text = String(title ?? "");
  if (!text.includes("%s")) return text;
  const short = selection.length > 32 ? `${selection.slice(0, 32)}…` : selection;
  return text.split("%s").join(short);
}

/**
 * Electron menu template for the extensions' context-menu items that apply
 * to this click. One top-level item shows as is; several are grouped under
 * the extension's name, as Chrome does.
 *
 * extensions: [{ id, name, icon?, items: [item…] }] in creation order.
 * onClick(extensionId, item) runs when an entry is picked.
 */
function contextMenuTemplate(extensions, params, onClick, contexts) {
  const active = contexts || clickContexts(params);
  const selection = String(params.selectionText || "").trim();
  const template = [];
  for (const extension of extensions) {
    const items = extension.items || [];
    const build = (parentId, inherited) =>
      items
        .filter((item) => (item.parentId ?? null) === parentId)
        .map((item) => ({
          ...item,
          contexts: item.contexts?.length ? item.contexts : inherited,
        }))
        .filter((item) => itemApplies(item, active, params))
        .map((item) => {
          if (item.type === "separator") return { type: "separator" };
          const children = build(item.id, item.contexts);
          const entry = {
            label: menuLabel(item.title, selection),
            enabled: item.enabled !== false,
          };
          if (children.length) entry.submenu = children;
          else {
            if (item.type === "checkbox" || item.type === "radio") {
              entry.type = item.type;
              entry.checked = Boolean(item.checked);
            }
            entry.click = () => onClick(extension.id, item);
          }
          return entry;
        });
    const top = build(null, undefined);
    if (!top.length) continue;
    template.push(
      top.length === 1
        ? { ...top[0], icon: extension.icon }
        : { label: extension.name, icon: extension.icon, submenu: top },
    );
  }
  return template;
}

/** chrome.contextMenus.onClicked's info for a picked item. */
function menuClickInfo(item, params, wasChecked) {
  const info = {
    menuItemId: item.id,
    editable: Boolean(params.isEditable),
    pageUrl: params.pageURL || undefined,
  };
  if (item.parentId != null) info.parentMenuItemId = item.parentId;
  if (params.frameURL) info.frameUrl = params.frameURL;
  if (params.linkURL) info.linkUrl = params.linkURL;
  if (params.srcURL) info.srcUrl = params.srcURL;
  if (["image", "video", "audio"].includes(params.mediaType))
    info.mediaType = params.mediaType;
  const selection = String(params.selectionText || "");
  if (selection) info.selectionText = selection;
  if (item.type === "checkbox" || item.type === "radio") {
    info.wasChecked = Boolean(wasChecked);
    info.checked = item.type === "radio" ? true : !wasChecked;
  }
  return info;
}

// ── toolbar action state ───────────────────────────────────────

/** The toolbar action a manifest declares, if any. */
function manifestAction(manifest = {}) {
  return manifest.action || manifest.browser_action || manifest.page_action || null;
}

/**
 * Icon file for the toolbar: the action's icon, else the extension's own,
 * at the size nearest 32px (16px drawn at 2x).
 */
function pickIconPath(manifest = {}) {
  const action = manifestAction(manifest);
  const candidates = [action?.default_icon, manifest.icons];
  for (const icon of candidates) {
    if (!icon) continue;
    if (typeof icon === "string") return icon;
    const sizes = Object.keys(icon)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (!sizes.length) continue;
    const size = sizes.find((n) => n >= 32) ?? sizes[sizes.length - 1];
    return icon[String(size)];
  }
  return null;
}

/** Badge colour from chrome.action's string or [r, g, b, a] form. */
function cssColor(color) {
  if (typeof color === "string") return color;
  if (Array.isArray(color) && color.length >= 3) {
    const [r, g, b, a = 255] = color.map((n) => Number(n) || 0);
    return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
  }
  return undefined;
}

/** State of one extension's action for a tab: per-tab values win. */
function effectiveAction(state, tabId) {
  const global = state?.global || {};
  const perTab = tabId != null ? state?.tabs?.get?.(tabId) || {} : {};
  return { ...global, ...perTab };
}

/** Popup bounds under its toolbar button, kept inside the work area. */
function popupBounds({ anchor, contentBounds, zoom = 1, size, workArea }) {
  const width = Math.min(Math.max(Math.round(size.width), 25), 800);
  const height = Math.min(Math.max(Math.round(size.height), 25), 600);
  const right = contentBounds.x + Math.round(anchor.right * zoom);
  let x = right - width;
  let y = contentBounds.y + Math.round(anchor.bottom * zoom) + 4;
  if (workArea) {
    x = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width);
    y = Math.min(y, workArea.y + workArea.height - height);
  }
  return { x, y, width, height };
}

module.exports = {
  WINDOW_ID,
  WINDOW_ID_CURRENT,
  matchPattern,
  globMatch,
  matchesTabQuery,
  clickContexts,
  contextMenuTemplate,
  menuClickInfo,
  manifestAction,
  pickIconPath,
  cssColor,
  effectiveAction,
  popupBounds,
};
