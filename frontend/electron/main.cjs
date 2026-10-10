/**
 * Echo desktop shell — main process.
 *
 * Rebuilt 2026-06-13 against the contract in src/types/electron.d.ts
 * (the original electron/ directory was never committed and was lost).
 * See electron/README.md for what is fully implemented vs. stubbed.
 */
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
  session,
  systemPreferences,
  webContents,
} = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  spawnBackend,
  killBackend,
  ensureOptionalDeps,
} = require("./backend-runtime.cjs");
const petSidecar = require("./pet-sidecar.cjs");
const desktopCore = require("./desktop-shell-core.cjs");
const { selectPreviewSource } = require("./automation-preview.cjs");
const desktopProtocol = require("./desktop-protocol.cjs");
const mcpOAuthDeepLink = require("./mcp-oauth-deep-link.cjs");
const { startBrowserControlBridge } = require("./browser-control-bridge.cjs");
const extensionStore = require("./extension-store.cjs");
const { createExtensionHost } = require("./extension-host.cjs");
let browserControlBridge = null;
let activeBrowserTabId = null;
const {
  ensureDesktopConfigFile,
  ensureDesktopResources,
} = require("./desktop-config.cjs");

const DEV_URL = process.env.ELECTRON_START_URL || "http://127.0.0.1:3310";
const DESKTOP_DIR = path.join(os.homedir(), "Desktop");

// ``--smoke-test`` launches the packaged-style shell against the built
// ``dist/`` from an unpackaged checkout, so the Playwright Electron E2E can
// prove the shell + preload bridge + workbench boot without a dev server.
// ``--smoke-test-backend`` additionally spawns the Python backend (normally a
// packaged-only path) so the spawn + health + renderer-connection chain is
// exercised; that development smoke reuses an existing venv via
// ECHO_DESKTOP_BACKEND_ROOT. Release builds use only the bundled executable.
const SMOKE_TEST = process.argv.includes("--smoke-test");
const SMOKE_TEST_BACKEND = process.argv.includes("--smoke-test-backend");
const BUILT_RENDERER_SMOKE = SMOKE_TEST || SMOKE_TEST_BACKEND;

async function captureAutomationPreview(request = {}) {
  const width = Math.max(320, Math.min(1280, Number(request.width) || 800));
  const height = Math.max(180, Math.min(720, Number(request.height) || 450));
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width, height },
      fetchWindowIcons: true,
    });
    const usable = sources.filter(
      (source) => source?.thumbnail && !source.thumbnail.isEmpty(),
    );
    const selected = selectPreviewSource(usable, request);
    if (!selected) {
      return {
        ok: false,
        error: "Selected window is unavailable; select the window again",
      };
    }
    const size = selected.thumbnail.getSize();
    return {
      ok: true,
      dataUrl: selected.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
      sourceId: selected.id,
      sourceName: selected.name,
      matched: true,
      iconUrl: selected.appIcon?.toDataURL(),
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// A standard, secure application origin gives the packaged renderer normal
// browser URL semantics and persistent storage without weakening Chromium's
// web security. The handler is installed after ready and serves only bundled
// assets plus a narrow loopback-backend proxy.
protocol.registerSchemesAsPrivileged([
  {
    scheme: desktopProtocol.DESKTOP_APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

// Preserve the identity of the previously shipped Windows shell so upgrades
// retain their taskbar grouping, installer identity, and existing userData.
if (process.platform === "win32") {
  app.setAppUserModelId("ai.echo.desktop");
}

// Force Chinese locale for native dialogs and system UI so native controls
// (Cancel / New Folder / sidebar / search) follow the app's primary language.
app.commandLine.appendSwitch("lang", "zh-CN");
app.commandLine.appendSwitch("accept-lang", "zh-CN,zh;q=0.9,en;q=0.8");

// ── auto-update (electron-updater, packaged builds only) ───────
// electron-updater is an optional dependency; guard the require so an
// uninstalled package degrades to "auto-update disabled" instead of crashing.
// To enable: `pnpm add -D electron-updater` and configure `publish` in
// packaging/desktop/build.yml (see the commented feed examples there).
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (err) {
    console.warn(
      "[echo] electron-updater not installed; auto-update disabled:",
      err.message,
    );
  }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on("update-downloaded", (info) => {
    // Fires the "app:update-downloaded" channel that the renderer subscribes
    // to via preload on() — this was previously marked "无触发源".
    mainWindow?.webContents.send("app:update-downloaded", {
      version: info?.version,
      releaseName: info?.releaseName,
    });
  });
  autoUpdater.on("error", (err) => {
    console.warn("[echo] auto-update error:", err?.message || err);
  });
  ipcMain.on("app:check-for-update", () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[echo] check-for-update failed:", err?.message || err);
    });
  });
  ipcMain.on("app:install-update", () => {
    autoUpdater.quitAndInstall();
  });
}

let mainWindow = null;
// Toolbar actions, menus and the other extension APIs Electron lacks.
let extensionHost = null;
const auxiliaryWindows = new Map();
const BROWSER_PARTITION = "persist:echo-browser";
// Private tabs: in-memory session, nothing written to disk.
const PRIVATE_BROWSER_PARTITION = "echo-private";

function browserProfileSession() {
  return session.fromPartition(BROWSER_PARTITION);
}

function openUrlInBrowserTab(url) {
  mainWindow?.webContents.send("browser:open-tab", { url });
}

// ── backend URL ────────────────────────────────────────────────
function resolveBackendBaseURL() {
  return desktopProtocol.normalizeLoopbackBackendBaseURL(
    process.env.ECHO_BACKEND_URL || "http://127.0.0.1:8310",
  );
}

function installDesktopRendererProtocol() {
  const distRoot = path.join(__dirname, "..", "dist");
  if (!desktopProtocol.resolveDesktopAssetPath(distRoot, "/index.html")) {
    throw new Error(`desktop renderer entry is missing from ${distRoot}`);
  }
  let lastProxyWarningAt = 0;
  const handler = desktopProtocol.createDesktopProtocolHandler({
    distRoot,
    backendBaseURL: resolveBackendBaseURL(),
    fetchImpl: (url, init) => net.fetch(url, init),
    onProxyError: (error) => {
      const now = Date.now();
      if (now - lastProxyWarningAt < 5_000) return;
      lastProxyWarningAt = now;
      console.warn(
        "[echo] desktop backend proxy unavailable:",
        error?.message || error,
      );
    },
  });
  protocol.handle(desktopProtocol.DESKTOP_APP_SCHEME, handler);
}

// ── packaged backend hosting ───────────────────────────────────
// In packaged mode the main process owns the fixed PyInstaller backend child
// process (see backend-runtime.cjs). The installer is deliberately offline at
// runtime: no venv creation, system uv fallback, or dependency downloads. In
// dev mode the backend runs externally (pnpm dev:full) and backend.restart
// degrades to {ok:false, reason}.

function backendConfigPath() {
  // Keep the legacy shell's config.yaml filename so an in-place upgrade
  // rotates its weak secret instead of silently creating a second config.
  return path.join(app.getPath("userData"), "config.yaml");
}

function backendProgress({ stage, message }) {
  try {
    mainWindow?.webContents.send("backend:bootstrap-progress", {
      stage,
      message,
    });
  } catch {
    /* window may not exist yet */
  }
}

// ── first-launch config (packaging/desktop/config.desktop.yaml) ──
function ensureDesktopConfig() {
  const target = backendConfigPath();
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, "config.desktop.yaml")
    : path.join(
        __dirname,
        "..",
        "..",
        "packaging",
        "desktop",
        "config.desktop.yaml",
      );
  return ensureDesktopConfigFile({ bundledPath: bundled, targetPath: target });
}

function ensurePackagedResources() {
  const bundledRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..");
  return ensureDesktopResources({
    bundledRoot,
    targetRoot: path.join(app.getPath("userData"), "resources"),
  });
}

// ── desktop organizer (the 桌面助手 backend) ───────────────────
const journalFile = () =>
  path.join(app.getPath("userData"), "desktop-organizer-journal.json");

function readJournal() {
  return desktopCore.readJournalFile(journalFile());
}

function writeJournal(entries) {
  desktopCore.writeJournalFile(journalFile(), entries);
}

async function listDesktopItems() {
  const names = await fsp.readdir(DESKTOP_DIR);
  const items = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const p = path.join(DESKTOP_DIR, name);
    let st;
    try {
      st = await fsp.stat(p);
    } catch {
      continue;
    }
    items.push(desktopCore.buildDesktopItem(name, p, st));
  }
  return items;
}

function isDirectDesktopItem(candidate) {
  return desktopCore.isDirectDesktopItem(candidate, DESKTOP_DIR);
}

async function moveDesktopItem(srcPath, destDir) {
  const resolved = desktopCore.resolveMoveTarget(srcPath, destDir, DESKTOP_DIR);
  if (resolved.error) return { ok: false, error: resolved.error };
  const target = resolved.target;
  const dest = path.dirname(target);
  await fsp.mkdir(dest, { recursive: true });
  if (fs.existsSync(target)) return { ok: true, skipped: true };
  await fsp.rename(srcPath, target);
  const journal = readJournal();
  journal.push({ from: srcPath, to: target, ts: Date.now() });
  writeJournal(journal);
  return { ok: true, destPath: target };
}

// CPU usage is the busy share since the previous sample (the first sample
// covers the time since boot); os.loadavg() is always 0 on Windows.
let lastCpuTimes = null;
function cpuUsagePercent(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
  }
  const previous = lastCpuTimes;
  lastCpuTimes = { idle, total };
  const busy = previous
    ? total - previous.total - (idle - previous.idle)
    : total - idle;
  const span = previous ? total - previous.total : total;
  return span > 0
    ? Math.max(0, Math.min(100, Math.round((busy / span) * 100)))
    : 0;
}

function sampleSystemInfo() {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    ok: true,
    cpu: {
      model: cpus[0]?.model || "unknown",
      cores: cpus.length,
      usage: cpuUsagePercent(cpus),
    },
    memory: {
      total,
      used: total - free,
      percent: Math.round(((total - free) / total) * 100),
    },
    uptime: os.uptime(),
    platform: process.platform,
  };
}

// ── browser bridge (embedded <webview> automation) ─────────────
function wc(webContentsId) {
  const target = webContents.fromId(webContentsId);
  if (!target || target.isDestroyed())
    throw new Error(`webContents ${webContentsId} not found`);
  // The browser bridge only drives embedded <webview> tabs. Refuse to
  // execute JS / capture / navigate in the main window or any other
  // webContents, so a compromised renderer cannot pivot off its own
  // webviews into contexts it was never meant to touch (defense in depth;
  // the app's own UI is otherwise treated as trusted).
  if (target.getType() !== "webview") {
    throw new Error(`webContents ${webContentsId} is not a webview`);
  }
  return target;
}

const js = {
  click: (sel) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { ok: false, error: "selector not found" };
    el.scrollIntoView({ block: "center" });
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 120) };
  })()`,
  type: (sel, text, clear) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { ok: false, error: "selector not found" };
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
    const next = ${JSON.stringify(!!clear)} ? ${JSON.stringify(text)} : (el.value || "") + ${JSON.stringify(text)};
    if (setter) setter.call(el, next); else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: el.value };
  })()`,
  hover: (sel) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { ok: false, error: "selector not found" };
    el.scrollIntoView({ block: "center" });
    for (const t of ["pointerover", "mouseover", "mouseenter"])
      el.dispatchEvent(new MouseEvent(t, { bubbles: true }));
    return { ok: true };
  })()`,
  scroll: (opts) => `(() => {
    const o = ${JSON.stringify(opts)};
    const el = o.selector ? document.querySelector(o.selector) : null;
    if (o.selector && !el) return { ok: false, error: "selector not found" };
    (el || window).scrollBy({ left: o.deltaX || 0, top: o.deltaY || 0, behavior: "instant" });
    return { ok: true, y: el ? el.scrollTop : window.scrollY };
  })()`,
  waitFor: (sel, timeout) => `new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (document.querySelector(${JSON.stringify(sel)}))
        return resolve({ ok: true, elapsed: Date.now() - t0 });
      if (Date.now() - t0 > ${Number(timeout) || 10000})
        return resolve({ ok: false, error: "timeout", elapsed: Date.now() - t0 });
      setTimeout(tick, 100);
    };
    tick();
  })`,
  extractText: `(() => {
    const text = document.body ? document.body.innerText : "";
    const max = 200000;
    return {
      url: location.href,
      title: document.title,
      text: text.slice(0, max),
      truncated: text.length > max,
      textLength: text.length,
    };
  })()`,
};

function activeBrowserTarget() {
  if (activeBrowserTabId == null || !mainWindow || mainWindow.isDestroyed())
    return null;
  try {
    const target = wc(activeBrowserTabId);
    return target.hostWebContents?.id === mainWindow.webContents.id
      ? target
      : null;
  } catch {
    return null;
  }
}

async function runBrowserControlAction(target, action, data) {
  if (action === "current-url") {
    return { ok: true, url: target.getURL(), title: target.getTitle() };
  }
  if (action === "execute-js") {
    return {
      ok: true,
      result: await target.executeJavaScript(String(data.code || ""), true),
    };
  }
  if (action === "navigate") {
    const url = new URL(String(data.url || ""));
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("unsupported URL");
    await target.loadURL(url.href);
    return { ok: true, url: target.getURL(), title: target.getTitle() };
  }
  if (action === "screenshot") {
    const capture = await target.capturePage();
    return { ok: true, dataUrl: capture.toDataURL(), ...capture.getSize() };
  }
  const scripts = {
    click: () => js.click(String(data.selector || "")),
    type: () =>
      js.type(String(data.selector || ""), String(data.text || ""), data.clear),
    scroll: () => js.scroll(data),
    wait: () =>
      js.waitFor(
        String(data.selector || ""),
        Math.max(1, Math.min(30000, Number(data.timeout) || 10000)),
      ),
    extract: () => js.extractText,
    // Do not return input values: password and other filled fields can contain secrets.
    state: () => `(() => {
      const limit = ${Math.max(1, Math.min(100, Number(data.max_items) || 30))};
      const items = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"]')]
        .filter(el => el.getClientRects().length).slice(0, limit).map(el => ({
          tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
          name: el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText || '',
          selector: el.id ? '#' + CSS.escape(el.id) : null,
          type: el.getAttribute('type'), disabled: !!el.disabled
        }));
      return { ok: true, url: location.href, title: document.title, items };
    })()`,
  };
  const result = await target.executeJavaScript(scripts[action](), true);
  return { ok: true, ...result };
}

const DEVICE_PRESETS = {
  mobile: {
    width: 390,
    height: 844,
    dpr: 3,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  tablet: {
    width: 820,
    height: 1180,
    dpr: 2,
    mobile: true,
    ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

async function getAriaTree(target, opts) {
  const attachedHere = !target.debugger.isAttached();
  if (attachedHere) target.debugger.attach("1.3");
  try {
    const { nodes } = await target.debugger.sendCommand(
      "Accessibility.getFullAXTree",
      {
        max_depth: opts?.maxDepth,
      },
    );
    return {
      ok: true,
      nodes: nodes.map((n) => ({
        id: String(n.nodeId),
        role: n.role?.value ?? "",
        name: n.name?.value ?? "",
        value: n.value?.value ?? "",
        backendDOMNodeId: n.backendDOMNodeId,
        childIds: (n.childIds || []).map(String),
        ignored: !!n.ignored,
      })),
    };
  } finally {
    if (attachedHere) {
      try {
        target.debugger.detach();
      } catch {
        /* already detached */
      }
    }
  }
}

// ── downloads ──────────────────────────────────────────────────
const downloads = new Map();
let downloadSeq = 0;

const passwordVaultFile = () =>
  path.join(app.getPath("userData"), "browser-passwords.enc.json");

function normalizeHttpOrigin(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http(s) origins are supported");
  }
  return parsed.origin;
}

/** Save or update the login for origin + username. */
function storePasswordEntry(entry) {
  const origin = normalizeHttpOrigin(entry?.origin);
  const username = String(entry?.username || "").trim();
  const password = String(entry?.password || "");
  if (!username || !password) throw new Error("username and password required");
  const entries = readPasswordVault();
  const existing = entries.find(
    (item) => item.origin === origin && item.username === username,
  );
  const next = {
    id:
      existing?.id ||
      `pwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    origin,
    username,
    password,
    updatedAt: Date.now(),
  };
  writePasswordVault([next, ...entries.filter((item) => item.id !== next.id)]);
}

// Sites the user told never to offer saving a password for.
const passwordNeverFile = () =>
  path.join(app.getPath("userData"), "browser-password-never.json");

function readPasswordNeverSites() {
  try {
    const list = JSON.parse(fs.readFileSync(passwordNeverFile(), "utf8"));
    return Array.isArray(list) ? list.filter((o) => typeof o === "string") : [];
  } catch {
    return [];
  }
}

function writePasswordNeverSites(origins) {
  fs.writeFileSync(passwordNeverFile(), JSON.stringify([...new Set(origins)]));
}

// Logins submitted in a browser tab wait here (password stays in the main
// process) until the user answers the "save password?" prompt.
const pendingPasswordOffers = new Map();
const PASSWORD_OFFER_TTL_MS = 10 * 60 * 1000;

function offerToSavePassword(event, payload) {
  const sender = event.sender;
  if (
    sender.getType() !== "webview" ||
    event.senderFrame !== sender.mainFrame ||
    // Private tabs (and any other session) never offer to save.
    sender.session !== browserProfileSession() ||
    !passwordVaultAvailable()
  )
    return;
  let origin;
  try {
    origin = normalizeHttpOrigin(event.senderFrame.url);
  } catch {
    return;
  }
  const username = String(payload?.username || "")
    .trim()
    .slice(0, 200);
  const password = String(payload?.password || "").slice(0, 500);
  if (!username || !password) return;
  if (readPasswordNeverSites().includes(origin)) return;
  const existing = readPasswordVault().find(
    (item) => item.origin === origin && item.username === username,
  );
  if (existing?.password === password) return;
  const now = Date.now();
  for (const [token, offer] of pendingPasswordOffers) {
    if (now - offer.at > PASSWORD_OFFER_TTL_MS)
      pendingPasswordOffers.delete(token);
  }
  const token = `offer-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  pendingPasswordOffers.set(token, { origin, username, password, at: now });
  mainWindow?.webContents.send("browser:password-offer", {
    token,
    origin,
    username,
    update: Boolean(existing),
    webContentsId: sender.id,
  });
}

function passwordVaultAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function readPasswordVault() {
  if (!passwordVaultAvailable()) return [];
  try {
    const envelope = JSON.parse(fs.readFileSync(passwordVaultFile(), "utf8"));
    if (envelope?.version !== 1 || typeof envelope.payload !== "string") {
      return [];
    }
    const clear = safeStorage.decryptString(
      Buffer.from(envelope.payload, "base64"),
    );
    const entries = JSON.parse(clear);
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[echo] password vault could not be read:", error.message);
    }
    return [];
  }
}

function writePasswordVault(entries) {
  if (!passwordVaultAvailable()) {
    throw new Error("system encryption is unavailable");
  }
  const target = passwordVaultFile();
  const temporary = `${target}.tmp`;
  const payload = safeStorage
    .encryptString(JSON.stringify(entries))
    .toString("base64");
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, payload }), {
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

function publicPasswordEntry(entry) {
  return {
    id: entry.id,
    origin: entry.origin,
    username: entry.username,
    updatedAt: entry.updatedAt,
  };
}

const sitePermissionsFile = () =>
  path.join(app.getPath("userData"), "browser-site-permissions.json");

function readSitePermissions() {
  try {
    const entries = JSON.parse(fs.readFileSync(sitePermissionsFile(), "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[echo] site permissions could not be read:", error.message);
    }
    return [];
  }
}

function writeSitePermissions(entries) {
  fs.writeFileSync(sitePermissionsFile(), JSON.stringify(entries, null, 2), {
    mode: 0o600,
  });
}

function permissionKey(permission, details = {}) {
  if (permission === "geolocation") return "location";
  if (permission === "notifications") return "notifications";
  if (permission === "clipboard-read") return "clipboard";
  if (permission !== "media") return null;
  const mediaTypes = Array.isArray(details.mediaTypes)
    ? details.mediaTypes
    : [];
  const audio = mediaTypes.includes("audio");
  const video = mediaTypes.includes("video");
  if (audio && video) return "camera-microphone";
  if (video) return "camera";
  if (audio) return "microphone";
  return null;
}

const permissionLabels = {
  camera: "摄像头",
  microphone: "麦克风",
  "camera-microphone": "摄像头和麦克风",
  location: "位置信息",
  notifications: "通知",
  clipboard: "剪贴板读取",
};

function savedSitePermission(origin, permission) {
  return readSitePermissions().find(
    (entry) => entry.origin === origin && entry.permission === permission,
  );
}

function saveSitePermission(origin, permission, decision) {
  const entries = readSitePermissions().filter(
    (entry) => !(entry.origin === origin && entry.permission === permission),
  );
  if (decision !== "ask") {
    entries.unshift({ origin, permission, decision, updatedAt: Date.now() });
  }
  writeSitePermissions(entries);
}

function configureBrowserPermissionRequests(sess) {
  sess.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (contents.getType() !== "webview") {
        callback(false);
        return;
      }
      const key = permissionKey(permission, details);
      if (!key) {
        callback(false);
        return;
      }
      let origin;
      try {
        origin = normalizeHttpOrigin(
          details?.requestingUrl ||
            details?.securityOrigin ||
            contents.getURL(),
        );
      } catch {
        callback(false);
        return;
      }
      const saved = savedSitePermission(origin, key);
      if (saved) {
        callback(saved.decision === "allow");
        return;
      }
      void dialog
        .showMessageBox(mainWindow, {
          type: "question",
          title: "网站权限请求",
          message: `${origin} 想要使用${permissionLabels[key]}`,
          detail:
            "只在确认网站可信且当前功能确实需要时允许。你可以稍后在“浏览器数据与隐私”中撤销。",
          buttons: ["允许", "阻止"],
          defaultId: 1,
          cancelId: 1,
          checkboxLabel: "记住此网站的选择",
          checkboxChecked: false,
          noLink: true,
        })
        .then(({ response, checkboxChecked }) => {
          const allow = response === 0;
          if (checkboxChecked) {
            saveSitePermission(origin, key, allow ? "allow" : "block");
          }
          callback(allow);
        })
        .catch(() => callback(false));
    },
  );
}

function downloadRisk(filename) {
  const lower = String(filename || "").toLowerCase();
  if (
    /\.(exe|msi|msp|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|wsh|reg|app|dmg|pkg|deb|rpm|apk)$/i.test(
      lower,
    )
  ) {
    return "high";
  }
  if (/\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(lower)) return "medium";
  return "low";
}

function trackDownloads(sess) {
  sess.on("will-download", (_event, item, sourceContents) => {
    const id = `dl-${++downloadSeq}`;
    const createdAt = Date.now();
    const filename = item.getFilename();
    const risk = downloadRisk(filename);
    const url = item.getURL();
    let sourceOrigin = "";
    try {
      sourceOrigin = normalizeHttpOrigin(sourceContents?.getURL() || url);
    } catch {
      sourceOrigin = "unknown";
    }
    const send = (state) => {
      downloads.set(id, {
        item,
        path: item.getSavePath(),
        url,
        filename,
        risk,
        sourceOrigin,
        createdAt,
        send,
        sourceContents,
      });
      mainWindow?.webContents.send("browser:download-event", {
        id,
        filename,
        url,
        sourceOrigin,
        risk,
        state: state === "started" ? "progressing" : state,
        paused: item.isPaused(),
        canResume: item.canResume(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        createdAt,
      });
    };
    send("started");
    item.on("updated", (_e, state) => send(state));
    item.once("done", (_e, state) => send(state));
    if (risk === "high") {
      item.pause();
      send("progressing");
      void dialog
        .showMessageBox(mainWindow, {
          type: "warning",
          title: "高风险下载",
          message: `是否保留 ${filename}？`,
          detail: `此文件可能运行程序或修改设备。来源：${sourceOrigin}`,
          buttons: ["继续下载", "取消下载"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 0) item.resume();
          else item.cancel();
        })
        .catch(() => item.cancel());
    }
  });
}

// ── extensions ─────────────────────────────────────────────────
const extensionsFile = () =>
  path.join(app.getPath("userData"), "extensions.json");

function readExtensionRegistry() {
  try {
    return JSON.parse(fs.readFileSync(extensionsFile(), "utf8"));
  } catch {
    return [];
  }
}

function writeExtensionRegistry(list) {
  fs.writeFileSync(extensionsFile(), JSON.stringify(list, null, 2));
}

// Extensions run in browser tabs (the persistent browser profile), never in
// the app's own UI session; private tabs get none, as in Chrome.
function browserExtensions() {
  const ses = browserProfileSession();
  // Electron 35+ moved these methods to session.extensions.
  return ses.extensions ?? ses;
}

// Store installs are unpacked here; removing one deletes its folder.
const storeExtensionsDir = () =>
  path.join(app.getPath("userData"), "store-extensions");

function isStoreExtensionPath(dir) {
  const root = path.resolve(storeExtensionsDir());
  return path.resolve(dir).startsWith(root + path.sep);
}

/** Load an unpacked extension folder into browser tabs and register it. */
async function installExtensionFromDir(dir, source = "folder") {
  const manifest = JSON.parse(
    await fsp.readFile(path.join(dir, "manifest.json"), "utf8"),
  );
  const loaded = await browserExtensions().loadExtension(dir);
  const previous = readExtensionRegistry().find(
    (e) => e.path === dir || e.id === loaded.id,
  );
  // Store packages name themselves with __MSG_…__ placeholders; the
  // loaded extension carries the localized values.
  const info = {
    id: loaded.id,
    name: loaded.name || manifest.name || path.basename(dir),
    version: loaded.version || manifest.version || "0.0.0",
    description: loaded.manifest?.description || manifest.description || "",
    manifestVersion: manifest.manifest_version || 3,
    path: dir,
    enabled: true,
    installedAt: new Date().toISOString(),
    source,
    // A fresh install shows on the toolbar; an update keeps its place.
    pinned: previous?.pinned ?? true,
  };
  const registry = readExtensionRegistry().filter(
    (e) => e.path !== dir && e.id !== info.id,
  );
  registry.push(info);
  writeExtensionRegistry(registry);
  return info;
}

async function installExtensionFromStore(input) {
  const parsed = extensionStore.parseStoreInput(input);
  if (!parsed)
    return {
      ok: false,
      error: "不是 Chrome 应用店或 Edge 加载项的扩展链接 / ID",
    };
  let crx = null;
  let lastError = "";
  for (const url of extensionStore.crxDownloadUrls(
    parsed,
    process.versions.chrome,
  )) {
    try {
      const response = await net.fetch(url);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 64 * 1024 * 1024) {
        lastError = "扩展包过大";
        continue;
      }
      crx = body;
      break;
    } catch (err) {
      lastError = err.message;
    }
  }
  if (!crx) return { ok: false, error: `下载扩展失败：${lastError}` };
  const dir = path.join(storeExtensionsDir(), parsed.id);
  try {
    for (const ext of readExtensionRegistry()) {
      if (ext.path === dir) {
        try {
          browserExtensions().removeExtension(ext.id);
        } catch {
          /* not loaded */
        }
      }
    }
    await fsp.rm(dir, { recursive: true, force: true });
    extensionStore.extractZip(extensionStore.crxZip(crx), dir);
    return {
      ok: true,
      extension: await installExtensionFromDir(dir, parsed.store || "store"),
    };
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    writeExtensionRegistry(
      readExtensionRegistry().filter((e) => e.path !== dir),
    );
    return { ok: false, error: err.message };
  }
}

async function loadEnabledExtensions() {
  for (const ext of readExtensionRegistry()) {
    if (!ext.enabled) continue;
    try {
      await browserExtensions().loadExtension(ext.path);
    } catch (err) {
      console.warn(`[echo] extension ${ext.name} failed to load:`, err.message);
    }
  }
}

// ── bookmark import ────────────────────────────────────────────
// Bookmarks of a locally installed Chromium browser, read only when the
// user asks to import them. Folders are flattened.
function chromiumBookmarksPath(browser) {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const support = path.join(home, "Library", "Application Support");
  const paths = {
    chrome: {
      win32: path.join(
        local,
        "Google",
        "Chrome",
        "User Data",
        "Default",
        "Bookmarks",
      ),
      darwin: path.join(support, "Google", "Chrome", "Default", "Bookmarks"),
      linux: path.join(
        home,
        ".config",
        "google-chrome",
        "Default",
        "Bookmarks",
      ),
    },
    edge: {
      win32: path.join(
        local,
        "Microsoft",
        "Edge",
        "User Data",
        "Default",
        "Bookmarks",
      ),
      darwin: path.join(support, "Microsoft Edge", "Default", "Bookmarks"),
      linux: path.join(
        home,
        ".config",
        "microsoft-edge",
        "Default",
        "Bookmarks",
      ),
    },
  };
  return Object.hasOwn(paths, browser)
    ? paths[browser][process.platform] || null
    : null;
}

async function importChromiumBookmarks(browser) {
  const file = chromiumBookmarksPath(String(browser || ""));
  if (!file) return { ok: false, entries: [], error: "not-found" };
  try {
    const data = JSON.parse(await fsp.readFile(file, "utf8"));
    const entries = [];
    const walk = (node) => {
      if (!node || entries.length >= 500) return;
      if (node.type === "url" && /^https?:\/\//i.test(node.url || "")) {
        entries.push({
          title: String(node.name || node.url).slice(0, 300),
          url: node.url,
        });
      }
      for (const child of node.children || []) walk(child);
    };
    for (const root of Object.values(data.roots || {})) walk(root);
    return { ok: true, entries };
  } catch (err) {
    if (err?.code === "ENOENT")
      return { ok: false, entries: [], error: "not-found" };
    return { ok: false, entries: [], error: err.message };
  }
}

// ── per-tab back / forward history ─────────────────────────────
// Only URL and title are kept (no page state: it can hold form input), at
// most NAV_HISTORY_LIMIT entries around the current one.
const NAV_HISTORY_LIMIT = 50;

function trimNavigationHistory(entries, index) {
  const usable = [];
  let active = -1;
  entries.forEach((entry, i) => {
    const url = String(entry?.url || "");
    if (!/^https?:\/\//i.test(url)) return;
    if (i === index) active = usable.length;
    usable.push({ url, title: String(entry?.title || "").slice(0, 300) });
  });
  if (usable.length === 0) return { entries: [], index: -1 };
  if (active < 0) active = usable.length - 1;
  const start = Math.max(
    0,
    Math.min(
      active - (NAV_HISTORY_LIMIT - 10),
      usable.length - NAV_HISTORY_LIMIT,
    ),
  );
  return {
    entries: usable.slice(start, start + NAV_HISTORY_LIMIT),
    index: active - start,
  };
}

// A tab's history is queued by its src just before its webview attaches.
// The webview is then created without an initial load and the history is
// restored into it (restore() refuses a webContents that loaded a page).
const pendingNavigationRestores = new Map();
const webviewAttachQueue = [];

function restoreQueuedNavigation(contents) {
  contents.on("will-attach-webview", (_event, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, "webview-preload.cjs");
    const now = Date.now();
    for (const [src, item] of pendingNavigationRestores) {
      if (now - item.queuedAt > 30_000) pendingNavigationRestores.delete(src);
    }
    const pending = pendingNavigationRestores.get(params.src);
    pendingNavigationRestores.delete(params.src);
    webviewAttachQueue.push(pending ? { ...pending, src: params.src } : null);
    if (pending) params.src = "";
  });
  contents.on("did-attach-webview", (_event, guest) => {
    const pending = webviewAttachQueue.shift();
    if (!pending) return;
    guest.navigationHistory
      .restore({ entries: pending.entries, index: pending.index })
      .catch(() => guest.loadURL(pending.src).catch(() => {}));
  });
}

// ── webview keyboard shortcuts + context menu ──────────────────
// A focused page swallows keys, so tab shortcuts are forwarded to the
// browser UI; the renderer decides what they do.
function forwardBrowserShortcuts(contents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (!mod) return;
    const key = String(input.key || "").toLowerCase();
    const forwarded =
      ["t", "w", "l", "f", "p"].includes(key) ||
      /^[1-9]$/.test(key) ||
      input.key === "Tab" ||
      (input.shift && (key === "n" || key === "b"));
    if (!forwarded || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("browser:keyboard-shortcut", {
      key: input.key,
      shift: input.shift,
      alt: input.alt,
      meta: input.meta,
      control: input.control,
    });
    event.preventDefault();
  });
}

function showBrowserContextMenu(contents, params) {
  const template = [];
  const separate = () => {
    if (template.length && template[template.length - 1].type !== "separator")
      template.push({ type: "separator" });
  };
  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    template.push(
      {
        label: "在新标签页打开",
        click: () => openUrlInBrowserTab(params.linkURL),
      },
      { label: "复制链接", click: () => clipboard.writeText(params.linkURL) },
    );
    separate();
  }
  if (params.mediaType === "image" && params.srcURL) {
    template.push(
      {
        label: "复制图片",
        click: () => contents.copyImageAt(params.x, params.y),
      },
      {
        label: "复制图片地址",
        click: () => clipboard.writeText(params.srcURL),
      },
    );
    separate();
  }
  const selection = String(params.selectionText || "").trim();
  if (selection) {
    const ask = (action) =>
      mainWindow?.webContents.send("browser:ask-selection", {
        text: selection.slice(0, 4000),
        action,
      });
    template.push(
      { label: "AI 解释", click: () => ask("explain") },
      { label: "AI 翻译成中文", click: () => ask("translate") },
      { label: "问 AI…", click: () => ask("ask") },
    );
    separate();
  }
  if (params.isEditable) {
    template.push(
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" },
    );
    separate();
  } else if (selection) {
    template.push({ role: "copy", label: "复制" });
    separate();
  }
  const extensionItems = extensionHost?.contextMenuItems(contents, params);
  if (extensionItems?.length) {
    template.push(...extensionItems);
    separate();
  }
  const history = contents.navigationHistory;
  template.push(
    {
      label: "后退",
      enabled: history.canGoBack(),
      click: () => history.goBack(),
    },
    {
      label: "前进",
      enabled: history.canGoForward(),
      click: () => history.goForward(),
    },
    { label: "刷新", click: () => contents.reload() },
    { type: "separator" },
    {
      label: "检查元素",
      click: () => {
        if (!contents.isDevToolsOpened())
          contents.openDevTools({ mode: "detach" });
        contents.inspectElement(params.x, params.y);
      },
    },
  );
  Menu.buildFromTemplate(template).popup({ window: mainWindow || undefined });
}

// ── IPC wiring ─────────────────────────────────────────────────
function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => fn(...args));

  // app
  handle("app:getVersion", () => app.getVersion());
  handle("app:openExternal", (url) => shell.openExternal(url));
  handle("app:getPlatform", () => process.platform);

  // dialog
  handle("dialog:open", (options) =>
    dialog.showOpenDialog(mainWindow, options),
  );
  handle("dialog:save", (options) =>
    dialog.showSaveDialog(mainWindow, options),
  );

  // backend
  handle("backend:getBaseURL", () => resolveBackendBaseURL());
  ipcMain.on("backend:getBaseURLSync", (event) => {
    event.returnValue = resolveBackendBaseURL();
  });
  handle("backend:restart", async () => {
    if (!app.isPackaged) {
      // dev mode: backend runs externally (pnpm dev:full); nothing to own here.
      return {
        ok: false,
        reason:
          "backend runs externally in dev (pnpm dev:full); restart is only available in packaged builds",
      };
    }
    try {
      killBackend();
      await spawnBackend(backendConfigPath(), backendProgress);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });
  handle("backend:ensureOptionalDeps", async (group) => {
    if (!app.isPackaged) {
      return {
        ok: false,
        reason: "optional deps are managed by dev tooling in dev mode",
      };
    }
    try {
      await ensureOptionalDeps(group, backendProgress);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  });

  // window
  handle("window:setDeviceBounds", (mode, width, height) => {
    if (!mainWindow) return { ok: false, reason: "no window" };
    if (width && height)
      mainWindow.setContentSize(Math.round(width), Math.round(height));
    return { ok: true, mode };
  });
  handle("window:setTitleBarOverlay", (opts) => {
    try {
      if (process.platform === "win32" && mainWindow?.setTitleBarOverlay) {
        mainWindow.setTitleBarOverlay({
          color: opts.color,
          symbolColor: opts.symbolColor,
          height: 36,
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("window:setMousePassthrough", (enabled) => {
    if (!mainWindow) return { ok: false, error: "no window" };
    mainWindow.setIgnoreMouseEvents(!!enabled, { forward: true });
    return { ok: true, enabled: !!enabled };
  });
  handle("window:openDevTools", () => {
    mainWindow?.webContents.openDevTools({ mode: "detach" });
    return { ok: true };
  });
  handle("window:isFullScreen", () => {
    return { ok: true, fullScreen: mainWindow?.isFullScreen() ?? false };
  });

  // pet sidecar (Godot desktop pet)
  const petEnabled = () => process.env.ECHO_PET_DISABLED !== "1";
  handle("pet:start", () =>
    petEnabled()
      ? petSidecar.startPet()
      : { ok: false, reason: "pet disabled" },
  );
  handle("pet:stop", () => {
    petSidecar.stopPet();
    return { ok: true };
  });
  handle("pet:isRunning", () => ({
    ok: true,
    running: petSidecar.isPetRunning(),
  }));
  handle("pet:sendEvent", (state) => {
    if (!petEnabled()) return { ok: false, reason: "pet disabled" };
    const event = petSidecar.petEventForAgentState(state);
    if (!event) return { ok: false, reason: `unknown agent state: ${state}` };
    const sent = petSidecar.sendPetEvent(event.type, {
      intensity: event.intensity,
    });
    return { ok: sent, running: petSidecar.isPetRunning() };
  });
  handle("pet:sendRaw", (type, extra) => {
    if (!petEnabled()) return { ok: false, reason: "pet disabled" };
    const sent = petSidecar.sendPetEvent(type, extra);
    return { ok: sent, running: petSidecar.isPetRunning() };
  });

  // desktop organizer
  handle("desktop:getAutomationPermissions", () => {
    if (process.platform !== "darwin") {
      return {
        supported: false,
        platform: process.platform,
        screenRecording: "unknown",
        accessibility: "unknown",
      };
    }
    const screenRecording = systemPreferences.getMediaAccessStatus("screen");
    return {
      supported: true,
      platform: process.platform,
      screenRecording: ["granted", "denied", "restricted"].includes(
        screenRecording,
      )
        ? screenRecording
        : "unknown",
      accessibility: systemPreferences.isTrustedAccessibilityClient(false)
        ? "granted"
        : "denied",
    };
  });
  handle("desktop:openAutomationPermission", async (permission) => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "macOS only" };
    }
    const pane =
      permission === "screen-recording"
        ? "Privacy_ScreenCapture"
        : permission === "accessibility"
          ? "Privacy_Accessibility"
          : "";
    if (!pane) return { ok: false, error: "unknown permission" };
    try {
      await shell.openExternal(
        `x-apple.systempreferences:com.apple.preference.security?${pane}`,
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  handle("desktop:listItems", async () => {
    try {
      return {
        ok: true,
        desktopPath: DESKTOP_DIR,
        items: await listDesktopItems(),
      };
    } catch (err) {
      return { ok: false, items: [], error: err.message };
    }
  });
  handle("desktop:openItem", async (p) => {
    const error = await shell.openPath(p);
    return error ? { ok: false, error } : { ok: true };
  });
  handle("desktop:trashItem", async (p) => {
    try {
      // The renderer only receives desktop entries from listItems(). Keep the
      // destructive bridge equally narrow so it cannot delete arbitrary paths.
      if (!isDirectDesktopItem(p)) {
        return {
          ok: false,
          error: "Only direct items on the Desktop can be removed",
        };
      }
      if (!fs.existsSync(p))
        return { ok: false, error: "Item no longer exists" };
      await shell.trashItem(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("desktop:moveItem", async (srcPath, destDir) => {
    try {
      return await moveDesktopItem(srcPath, destDir);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("desktop:moveItemsBatch", async (items) => {
    let moved = 0;
    let skipped = 0;
    try {
      for (const { srcPath, category } of items) {
        const res = await moveDesktopItem(srcPath, category);
        if (res.skipped) skipped += 1;
        else moved += 1;
      }
      return { ok: true, moved, skipped };
    } catch (err) {
      return { ok: false, moved, skipped, error: err.message };
    }
  });
  handle("desktop:undoMoves", async () => {
    const journal = readJournal();
    let undone = 0;
    for (const entry of journal.reverse()) {
      try {
        if (fs.existsSync(entry.to) && !fs.existsSync(entry.from)) {
          await fsp.rename(entry.to, entry.from);
          undone += 1;
        }
      } catch {
        /* keep undoing the rest */
      }
    }
    writeJournal([]);
    return { ok: true, undone };
  });
  handle("desktop:getSystemInfo", () => sampleSystemInfo());
  handle("desktop:captureAutomationPreview", (request) =>
    captureAutomationPreview(request),
  );
  handle("desktop:installContextMenu", () => {
    // Windows-only shell integration: register "Open with Echo" in the
    // Explorer right-click menu (files + folders) via the current-user registry.
    // Non-Windows platforms keep an honest degradation — there is no equivalent
    // OS-level shell menu to hook into from this process.
    if (process.platform !== "win32") {
      return {
        ok: false,
        error:
          "Windows-only feature: right-click shell menu integration is not supported on this platform",
      };
    }
    try {
      const { spawnSync } = require("child_process");
      const exe = process.execPath; // path to the packaged Echo.exe
      const entries = [
        ["HKCU\\Software\\Classes\\*\\shell\\Echo", "Open with Echo"],
        ["HKCU\\Software\\Classes\\Directory\\shell\\Echo", "Open with Echo"],
      ];
      for (const [key, label] of entries) {
        spawnSync("reg", ["add", key, "/d", label, "/f"], { stdio: "ignore" });
        spawnSync(
          "reg",
          ["add", `${key}\\command`, "/d", `"${exe}" "%1"`, "/f"],
          {
            stdio: "ignore",
          },
        );
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("desktop:removeContextMenu", () => {
    if (process.platform !== "win32") return { ok: true };
    try {
      const { spawnSync } = require("child_process");
      spawnSync(
        "reg",
        ["delete", "HKCU\\Software\\Classes\\*\\shell\\Echo", "/f"],
        {
          stdio: "ignore",
        },
      );
      spawnSync(
        "reg",
        ["delete", "HKCU\\Software\\Classes\\Directory\\shell\\Echo", "/f"],
        {
          stdio: "ignore",
        },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // embedded browser
  handle("browser:setDevice", async (id, mode) => {
    const target = wc(id);
    const preset = DEVICE_PRESETS[mode];
    if (!preset) {
      target.disableDeviceEmulation();
      target.setUserAgent(target.session.getUserAgent());
      return { ok: true, mode };
    }
    target.enableDeviceEmulation({
      screenPosition: "mobile",
      screenSize: { width: preset.width, height: preset.height },
      viewSize: { width: preset.width, height: preset.height },
      deviceScaleFactor: preset.dpr,
    });
    target.setUserAgent(preset.ua);
    return { ok: true, mode };
  });
  handle("browser:executeJS", (id, code) =>
    wc(id).executeJavaScript(code, true),
  );
  handle("browser:reload", (id) => wc(id).reload());
  handle("browser:goBack", (id) => wc(id).navigationHistory.goBack());
  handle("browser:goForward", (id) => wc(id).navigationHistory.goForward());
  handle("browser:openDevTools", (id) => {
    try {
      wc(id).openDevTools({ mode: "detach" });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:capturePage", async (id) => {
    const image = await wc(id).capturePage();
    const size = image.getSize();
    return {
      dataUrl: image.toDataURL(),
      width: size.width,
      height: size.height,
    };
  });
  handle("browser:extractText", (id) =>
    wc(id).executeJavaScript(js.extractText, true),
  );
  handle("browser:click", (id, sel) =>
    wc(id).executeJavaScript(js.click(sel), true),
  );
  handle("browser:type", (id, sel, text, opts) =>
    wc(id).executeJavaScript(js.type(sel, text, opts?.clear), true),
  );
  handle("browser:hover", (id, sel) =>
    wc(id).executeJavaScript(js.hover(sel), true),
  );
  handle("browser:scroll", (id, opts) =>
    wc(id).executeJavaScript(js.scroll(opts), true),
  );
  handle("browser:waitFor", (id, sel, timeout) =>
    wc(id).executeJavaScript(js.waitFor(sel, timeout), true),
  );
  handle("browser:pressKey", (id, key) => {
    const target = wc(id);
    target.focus();
    target.sendInputEvent({ type: "keyDown", keyCode: key });
    if (key.length === 1) target.sendInputEvent({ type: "char", keyCode: key });
    target.sendInputEvent({ type: "keyUp", keyCode: key });
    return { ok: true, key };
  });
  handle("browser:getAriaTree", async (id, opts) => {
    try {
      return await getAriaTree(wc(id), opts);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:getCurrentUrl", (id) => {
    const target = wc(id);
    return { ok: true, url: target.getURL(), title: target.getTitle() };
  });
  handle("browser:clearSiteData", async (id) => {
    try {
      const target = wc(id);
      const origin = new URL(target.getURL()).origin;
      await target.session.clearStorageData({ origin });
      return { ok: true, origin };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:clearBrowsingData", async () => {
    try {
      const sessions = [session.defaultSession, browserProfileSession()];
      await Promise.all(
        sessions.flatMap((browserSession) => [
          browserSession.clearStorageData(),
          browserSession.clearCache(),
          browserSession.clearAuthCache(),
        ]),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:listPasswords", (origin) => {
    try {
      const normalized = origin ? normalizeHttpOrigin(origin) : null;
      const entries = readPasswordVault()
        .filter((entry) => !normalized || entry.origin === normalized)
        .map(publicPasswordEntry)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, available: passwordVaultAvailable(), entries };
    } catch (err) {
      return {
        ok: false,
        available: passwordVaultAvailable(),
        entries: [],
        error: err.message,
      };
    }
  });
  handle("browser:savePassword", (entry) => {
    try {
      storePasswordEntry(entry);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:resolvePasswordOffer", (token, save) => {
    const offer = pendingPasswordOffers.get(String(token));
    pendingPasswordOffers.delete(String(token));
    if (!offer) return { ok: false, error: "offer expired" };
    if (save === "never") {
      writePasswordNeverSites([...readPasswordNeverSites(), offer.origin]);
      return { ok: true, saved: false };
    }
    if (!save) return { ok: true, saved: false };
    try {
      storePasswordEntry(offer);
      return { ok: true, saved: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:listPasswordNeverSites", () => ({
    ok: true,
    origins: readPasswordNeverSites(),
  }));
  handle("browser:removePasswordNeverSite", (origin) => {
    writePasswordNeverSites(
      readPasswordNeverSites().filter((item) => item !== origin),
    );
    return { ok: true };
  });
  ipcMain.on("browser-page:login-submitted", (event, payload) =>
    offerToSavePassword(event, payload),
  );
  handle("browser:deletePassword", (id) => {
    try {
      const entries = readPasswordVault();
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === entries.length) {
        return { ok: false, error: "password entry not found" };
      }
      writePasswordVault(next);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:fillPassword", async (id, entryId) => {
    try {
      const target = wc(id);
      const currentOrigin = normalizeHttpOrigin(target.getURL());
      const entry = readPasswordVault().find((item) => item.id === entryId);
      if (!entry) return { ok: false, error: "password entry not found" };
      if (entry.origin !== currentOrigin) {
        return {
          ok: false,
          error: "current site does not match password origin",
        };
      }
      const result = await target.executeJavaScript(
        `(() => {
          const username = ${JSON.stringify(entry.username)};
          const password = ${JSON.stringify(entry.password)};
          const passwordInput = document.querySelector('input[type="password"]');
          if (!(passwordInput instanceof HTMLInputElement)) {
            return { ok: false, error: "password field not found" };
          }
          const form = passwordInput.form;
          const scope = form || document;
          const usernameInput = scope.querySelector(
            'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[type="text"]'
          );
          const setValue = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, "value"
            )?.set;
            if (setter) setter.call(input, value); else input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          if (usernameInput instanceof HTMLInputElement) setValue(usernameInput, username);
          setValue(passwordInput, password);
          passwordInput.focus();
          return { ok: true, usernameFilled: usernameInput instanceof HTMLInputElement };
        })()`,
        true,
      );
      return result?.ok ? { ok: true } : result;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:print", (id) => {
    const target = wc(id);
    return new Promise((resolve) => {
      target.print({}, (success, reason) =>
        resolve(
          success ? { ok: true } : { ok: false, error: reason || "cancelled" },
        ),
      );
    });
  });
  handle("browser:importBookmarks", (browser) =>
    importChromiumBookmarks(browser),
  );
  handle("browser:getNavigationHistory", (id) => {
    const history = wc(id).navigationHistory;
    return {
      ok: true,
      ...trimNavigationHistory(
        history.getAllEntries(),
        history.getActiveIndex(),
      ),
    };
  });
  handle("browser:queueNavigationRestore", (src, entries, index) => {
    const trimmed = trimNavigationHistory(
      Array.isArray(entries) ? entries : [],
      Number(index),
    );
    if (typeof src !== "string" || trimmed.entries.length === 0)
      return { ok: false, error: "nothing to restore" };
    pendingNavigationRestores.set(src, { ...trimmed, queuedAt: Date.now() });
    return { ok: true };
  });
  handle("browser:listSitePermissions", () => ({
    ok: true,
    entries: readSitePermissions().sort((a, b) => b.updatedAt - a.updatedAt),
  }));
  handle("browser:setSitePermission", (origin, permission, decision) => {
    try {
      const normalized = normalizeHttpOrigin(origin);
      if (!Object.hasOwn(permissionLabels, permission)) {
        throw new Error("unsupported site permission");
      }
      if (!["ask", "allow", "block"].includes(decision)) {
        throw new Error("unsupported permission decision");
      }
      saveSitePermission(normalized, permission, decision);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:showDownloadInFolder", (id) => {
    const dl = downloads.get(id);
    if (!dl?.path) return { ok: false, error: "download not found" };
    shell.showItemInFolder(dl.path);
    return { ok: true };
  });
  handle("browser:openDownload", async (id) => {
    const dl = downloads.get(id);
    if (!dl?.path) return { ok: false, error: "download not found" };
    const error = await shell.openPath(dl.path);
    return error ? { ok: false, error } : { ok: true };
  });
  handle("browser:pauseDownload", (id) => {
    const dl = downloads.get(id);
    if (!dl?.item) return { ok: false, error: "download not found" };
    try {
      dl.item.pause();
      dl.send?.("progressing");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:resumeDownload", (id) => {
    const dl = downloads.get(id);
    if (!dl?.item) return { ok: false, error: "download not found" };
    try {
      if (!dl.item.canResume()) {
        return { ok: false, error: "download cannot be resumed" };
      }
      dl.item.resume();
      dl.send?.("progressing");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:cancelDownload", (id) => {
    const dl = downloads.get(id);
    if (!dl?.item) return { ok: false, error: "download not found" };
    try {
      dl.item.cancel();
      dl.send?.("cancelled");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("browser:retryDownload", (id) => {
    const dl = downloads.get(id);
    if (!dl?.url) return { ok: false, error: "download not found" };
    try {
      const source =
        dl.sourceContents && !dl.sourceContents.isDestroyed()
          ? dl.sourceContents
          : mainWindow.webContents;
      source.downloadURL(dl.url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // extensions
  handle("extensions:list", () => ({
    ok: true,
    extensions: readExtensionRegistry(),
  }));
  handle("extensions:installFromFolder", async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0])
      return { ok: false, canceled: true };
    const dir = picked.filePaths[0];
    try {
      return { ok: true, extension: await installExtensionFromDir(dir) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("extensions:installFromStore", (input) =>
    installExtensionFromStore(input),
  );
  handle("extensions:setEnabled", async (id, enabled) => {
    const registry = readExtensionRegistry();
    const ext = registry.find((e) => e.id === id);
    if (!ext) return { ok: false, error: "extension not found" };
    try {
      if (enabled) {
        const loaded = await browserExtensions().loadExtension(ext.path);
        ext.id = loaded.id;
      } else {
        browserExtensions().removeExtension(id);
      }
      ext.enabled = enabled;
      writeExtensionRegistry(registry);
      return { ok: true, extension: ext };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle("extensions:actions", (tabId) =>
    extensionHost
      ? extensionHost.listActions(tabId)
      : { ok: true, actions: [] },
  );
  handle("extensions:clickAction", (id, tabId, anchor) =>
    extensionHost?.clickAction(id, tabId, anchor),
  );
  handle("extensions:showActionMenu", (id, tabId) =>
    extensionHost?.showActionMenu(id, tabId),
  );
  handle("extensions:setPinned", (id, pinned) =>
    extensionHost?.setPinned(id, pinned),
  );
  handle("extensions:openOptions", (id) => extensionHost?.openOptions(id));
  handle("extensions:remove", async (id) => {
    extensionHost?.forget(id, { purge: true });
    try {
      browserExtensions().removeExtension(id);
    } catch {
      /* may not be loaded */
    }
    const registry = readExtensionRegistry();
    const removed = registry.find((e) => e.id === id);
    writeExtensionRegistry(registry.filter((e) => e.id !== id));
    // A store install's unpacked copy is ours to delete; a user's own
    // folder is left alone.
    if (removed && isStoreExtensionPath(removed.path))
      await fsp.rm(removed.path, { recursive: true, force: true });
    return { ok: true };
  });

  // active-tab bridge (fire-and-forget from renderer)
  ipcMain.on("bridge:setActiveTab", (event, id) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    if (id == null) {
      activeBrowserTabId = null;
      return;
    }
    activeBrowserTabId = null;
    try {
      const target = wc(id);
      if (target.hostWebContents?.id === event.sender.id)
        activeBrowserTabId = id;
      extensionHost?.tabActivated(activeBrowserTabId);
    } catch {
      /* invalid or destroyed tab */
    }
  });
}

// ── window ─────────────────────────────────────────────────────
function isSafeExternalURL(rawURL) {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(rawURL).protocol);
  } catch {
    return false;
  }
}

function openSafeExternalURL(rawURL) {
  if (!isSafeExternalURL(rawURL)) return;
  shell.openExternal(rawURL).catch((error) => {
    console.warn("[echo] unable to open external URL:", error.message);
  });
}

function attachMcpOAuthDeepLinkBridge(contents) {
  return mcpOAuthDeepLink.attachMcpOAuthDeepLinkBridge(contents, {
    backendBaseURL: resolveBackendBaseURL,
    // Never log the deep link or callback URL: both can contain a short-lived
    // authorization code. The backend consumes state exactly once, then PKCE.
    onNavigationError: (error) => {
      console.warn(
        "[echo] unable to complete MCP OAuth callback:",
        error?.message || "navigation failed",
      );
    },
  });
}

function configureMcpOAuthPopup(popupWindow) {
  const contents = popupWindow.webContents;
  const oauthBridge = attachMcpOAuthDeepLinkBridge(contents);
  contents.setWindowOpenHandler(({ url }) => {
    if (!oauthBridge.handleWindowOpen(url)) openSafeExternalURL(url);
    return { action: "deny" };
  });
  contents.on("render-process-gone", (_event, details) => {
    console.warn(
      "[echo] MCP OAuth popup renderer stopped:",
      details?.reason || "unknown",
    );
    if (!popupWindow.isDestroyed()) popupWindow.close();
  });
}

function isTrustedMainWindowURL(rawURL, useBuiltRenderer) {
  if (useBuiltRenderer) {
    const parsed = desktopProtocol.parseDesktopAppURL(rawURL);
    return parsed?.pathname === "/index.html" || parsed?.pathname === "/";
  }
  try {
    return new URL(rawURL).origin === new URL(DEV_URL).origin;
  } catch {
    return false;
  }
}

function openDesktopAuxiliaryWindow(rawURL, windowName = "echo-app") {
  if (!desktopProtocol.isDesktopAppURL(rawURL)) return;
  const existing = auxiliaryWindows.get(windowName);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const child = new BrowserWindow({
    width: 1180,
    height: 800,
    parent: mainWindow || undefined,
    webPreferences: {
      // Auxiliary app windows use the same trusted renderer as the main
      // window. Keep the preload bridge here so media/workbench apps retain
      // backend discovery, WebSocket transport, and native file actions.
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  auxiliaryWindows.set(windowName, child);
  child.on("closed", () => {
    if (auxiliaryWindows.get(windowName) === child) {
      auxiliaryWindows.delete(windowName);
    }
  });
  child.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalURL(url);
    return { action: "deny" };
  });
  child.webContents.on("will-navigate", (event, url) => {
    if (desktopProtocol.isDesktopAppURL(url)) return;
    event.preventDefault();
    openSafeExternalURL(url);
  });
  child.loadURL(rawURL).catch((error) => {
    console.warn("[echo] unable to open desktop page:", error.message);
    child.close();
  });
}

function createMainWindow() {
  const useBuiltRenderer = app.isPackaged || BUILT_RENDERER_SMOKE;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    ...(process.platform === "win32"
      ? { titleBarStyle: "hidden", titleBarOverlay: { height: 36 } }
      : process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset",
            trafficLightPosition: { x: 12, y: 12 },
          }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      additionalArguments:
        process.platform === "win32" || process.platform === "darwin"
          ? ["--echo-titlebar-overlay"]
          : [],
    },
  });

  win.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) win.show();
  });
  win.on("enter-full-screen", () => {
    win.webContents.send("window:fullscreen-changed", { fullScreen: true });
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("window:fullscreen-changed", { fullScreen: false });
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (
      frameName === "echo-mcp-oauth" &&
      mcpOAuthDeepLink.isSafeOAuthAuthorizeURL(url)
    ) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 620,
          height: 780,
          parent: win,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
          },
        },
      };
    }
    if (useBuiltRenderer && desktopProtocol.isDesktopAppURL(url)) {
      openDesktopAuxiliaryWindow(url, frameName || "echo-app");
    } else {
      openSafeExternalURL(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (childWindow, details) => {
    if (details?.frameName !== "echo-mcp-oauth") return;
    configureMcpOAuthPopup(childWindow);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedMainWindowURL(url, useBuiltRenderer)) return;
    event.preventDefault();
    openSafeExternalURL(url);
  });

  if (useBuiltRenderer) {
    win.loadURL(desktopProtocol.DESKTOP_APP_ENTRY_URL).catch((error) => {
      console.error("[echo] desktop renderer failed to load:", error);
    });
  } else {
    win.loadURL(DEV_URL);
    win.webContents.on("did-fail-load", (_e, code, desc) => {
      console.error(
        `[echo] dev server not reachable (${code} ${desc}); retrying in 1s…`,
      );
      setTimeout(() => win.loadURL(DEV_URL), 1000);
    });
  }
  return win;
}

function watchDesktop() {
  try {
    let timer = null;
    fs.watch(DESKTOP_DIR, () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => mainWindow?.webContents.send("desktop:items-changed"),
        500,
      );
    });
  } catch (err) {
    console.warn("[echo] desktop watch unavailable:", err.message);
  }
}

// ── lifecycle ──────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("open-url", (_event, url) => {
    mainWindow?.webContents.send("app:deep-link", url);
  });

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    const oauthBridge = attachMcpOAuthDeepLinkBridge(contents);
    contents.setWindowOpenHandler(({ url }) => {
      if (oauthBridge.handleWindowOpen(url)) {
        return { action: "deny" };
      }
      if (/^(https?:|view-source:)/i.test(url)) {
        openUrlInBrowserTab(url);
      }
      return { action: "deny" };
    });
    forwardBrowserShortcuts(contents);
    // Clicks inside a page never reach the app's DOM; split view needs to
    // know which pane was clicked to focus it.
    contents.on("before-mouse-event", (_e, mouse) => {
      if (mouse.type === "mouseDown")
        mainWindow?.webContents.send("browser:webview-pointer", contents.id);
    });
    contents.on("context-menu", (_e, params) =>
      showBrowserContextMenu(contents, params),
    );
    contents.on("render-process-gone", (_e, details) => {
      mainWindow?.webContents.send("browser:tab-crashed", {
        webContentsId: contents.id,
        reason: details.reason,
      });
    });
  });

  app.whenReady().then(async () => {
    if (!app.isPackaged) app.setAsDefaultProtocolClient("echo");
    try {
      if (app.isPackaged || BUILT_RENDERER_SMOKE) {
        installDesktopRendererProtocol();
      }
      ensureDesktopConfig();
      ensurePackagedResources();
    } catch (err) {
      const message = `无法安全初始化桌面应用：${err.message}`;
      console.error("[echo] desktop initialization failed:", err);
      dialog.showErrorBox("Echo 启动失败", message);
      app.exit(1);
      return;
    }
    registerIpc();
    setupAutoUpdater();
    configureBrowserPermissionRequests(session.defaultSession);
    configureBrowserPermissionRequests(browserProfileSession());
    trackDownloads(session.defaultSession);
    trackDownloads(browserProfileSession());
    const privateSession = session.fromPartition(PRIVATE_BROWSER_PARTITION);
    configureBrowserPermissionRequests(privateSession);
    extensionHost = createExtensionHost({
      session: browserProfileSession(),
      getMainWindow: () => mainWindow,
      getActiveTab: activeBrowserTarget,
      openUrlInTab: openUrlInBrowserTab,
      sendToRenderer: (channel, ...args) =>
        mainWindow?.webContents.send(channel, ...args),
      readRegistry: readExtensionRegistry,
      writeRegistry: writeExtensionRegistry,
    });
    extensionHost.install();
    trackDownloads(privateSession);
    mainWindow = createMainWindow();
    restoreQueuedNavigation(mainWindow.webContents);
    try {
      const bridgeDataDir =
        process.env.ECHO_DATA_DIR ||
        (app.isPackaged || SMOKE_TEST_BACKEND
          ? path.join(app.getPath("userData"), "data")
          : path.resolve(__dirname, "../../data"));
      browserControlBridge = await startBrowserControlBridge({
        statePath: path.join(bridgeDataDir, "bridge.json"),
        getTarget: activeBrowserTarget,
        runAction: runBrowserControlAction,
      });
    } catch {
      console.warn("[echo] browser control bridge could not start");
    }
    // Create the window before starting the bundled backend so the renderer
    // can show a bounded startup state while /readyz becomes available.
    if (app.isPackaged || SMOKE_TEST_BACKEND) {
      try {
        await spawnBackend(backendConfigPath(), backendProgress);
      } catch (err) {
        const message = `无法启动随应用安装的后端：${err.message}`;
        console.error("[echo] bundled backend start failed:", err);
        dialog.showErrorBox("Echo 启动失败", message);
        app.exit(1);
        return;
      }
    }
    await loadEnabledExtensions();
    watchDesktop();

    // Launch the Godot desktop pet sidecar (honest no-op when not resolvable).
    // Respect the renderer's persisted "显示宠物" switch (echo.pet.settings):
    // wait for the first load, then read the flag and skip startup when the
    // user has it turned off — otherwise the desktop window would pop up
    // against their choice on every launch.
    if (process.env.ECHO_PET_DISABLED !== "1") {
      const maybeStartPet = () => {
        const res = petSidecar.startPet();
        if (!res.ok && res.reason) {
          console.warn("[echo] pet sidecar not started:", res.reason);
        }
      };
      // executeJavaScript 需要页面已完成首帧加载；在这里监听 did-finish-load
      // 一次性事件，避免在导航完成前读取 localStorage 失败导致误启动。
      mainWindow.webContents.once("did-finish-load", () => {
        mainWindow.webContents
          .executeJavaScript(
            `(() => {
              try {
                const raw = localStorage.getItem("echo.pet.settings");
                if (!raw) return true;
                return (JSON.parse(raw).visible ?? true) !== false;
              } catch { return true; }
            })()`,
            true,
          )
          .then((visible) => {
            if (visible) maybeStartPet();
            else
              console.log("[echo] pet suppressed by settings (visible=false)");
          })
          .catch(() => maybeStartPet());
      });
    }

    if (process.env.ECHO_SMOKE === "1") {
      mainWindow.webContents.once("did-finish-load", () => {
        console.log("SMOKE OK:", mainWindow.webContents.getURL());
        setTimeout(() => app.quit(), 500);
      });
      setTimeout(() => {
        console.error("SMOKE TIMEOUT");
        app.exit(1);
      }, 30000);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        restoreQueuedNavigation(mainWindow.webContents);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Clean up the packaged backend child process on quit (also covers
  // window-all-closed → app.quit() on non-macOS).
  app.on("before-quit", () => {
    browserControlBridge?.close();
    killBackend();
    petSidecar.shutdown();
  });
}
