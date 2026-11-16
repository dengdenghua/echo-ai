const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const KINDS = new Set(["click", "move", "type", "key"]);
function nativeFeedbackDirectory(home = os.homedir()) {
  const canonicalHome = fs.realpathSync(home);
  const directory = path.join(canonicalHome, ".cache", "echo-os", "automation-feedback");
  let current = canonicalHome;
  for (const part of [".cache", "echo-os", "automation-feedback"]) {
    current = path.join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() ||
        (info.mode & (current === directory ? 0o077 : 0o022)) !== 0) {
      throw Error("Native feedback requires a private user-owned directory");
    }
  }
  return directory;
}
function publishNativeOwner(directory, session, display) {
  const owner = path.join(directory, "owner-" + session + ".json");
  const temporary = owner + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify({ session, display, at: Date.now() }), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, owner);
  } catch { /* Discovery failure only disables visual decoration. */ }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
function nativeScreenLocked(directory, display) {
  // A locker may run indefinitely. Bind the marker to its real process start
  // time instead of expiring it by wall clock or accepting a reused PID.
  try {
    let count = 0;
    for (const entry of fs.readdirSync(directory)) {
      if (!/^lock-[1-9][0-9]*\.json$/.test(entry)) continue;
      if (++count > 128) return true; // Disable decoration on ambiguous state.
      const file = path.join(directory, entry);
      let fd;
      try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const info = fs.fstatSync(fd);
        if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 512) continue;
        const buffer = Buffer.alloc(513);
        const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (size > 512) continue;
        const marker = JSON.parse(buffer.subarray(0, size).toString('utf8'));
        if (!Number.isSafeInteger(marker.pid) || marker.pid < 1 || entry !== `lock-${marker.pid}.json` ||
            typeof marker.start !== 'string' || !/^[0-9]+$/.test(marker.start) || typeof marker.display !== 'string') continue;
        let live = false;
        try {
          const proc = `/proc/${marker.pid}`;
          const stat = fs.readFileSync(proc + '/stat', 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          live = fs.statSync(proc).uid === process.getuid() && fields[19] === marker.start && !['Z', 'X'].includes(fields[0]);
        } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') return true; }
        if (!live) { try { fs.unlinkSync(file); } catch {} continue; }
        if (marker.display === display) return true;
      } catch { /* Untrusted marker is not a lock notification. */ }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    return false;
  } catch { return true; }
}
function validateFeedback(value, session, now = Date.now()) {
  if (!value || value.session !== session || !KINDS.has(value.kind) ||
      !["active", "done", "error"].includes(value.phase) ||
      typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id) ||
      !Number.isFinite(value.at) || now - value.at > 1800 || value.at - now > 1000) return null;
  const point = Number.isInteger(value.x) && Number.isInteger(value.y) ? { x: value.x, y: value.y } : {};
  return { id: value.id, kind: value.kind, phase: value.phase, at: value.at, ...point };
}
function createAutomationFeedback({ app, BrowserWindow, screen, directory = app.getPath("userData"), nativeAgent = false, home = os.homedir(), platform = process.platform }) {
  const session = crypto.randomBytes(16).toString("hex");
  const nativeDiscovery = nativeAgent && platform === "linux";
  if (nativeDiscovery) directory = nativeFeedbackDirectory(home);
  const file = path.join(directory, "automation-feedback-" + session + ".json");
  const owner = nativeDiscovery ? path.join(directory, "owner-" + session + ".json") : null;
  fs.mkdirSync(directory, { recursive: true });
  process.env.ECHO_AUTOMATION_FEEDBACK_FILE = file;
  process.env.ECHO_AUTOMATION_FEEDBACK_SESSION = session;
  let timer, animation, win, latest, reading = false, ready = false, lastPoint, generation = 0;
  let drawn = "", idleAt = 0, running = false, epoch = 0;
  let ownerTimer;
  let locked = false, acceptAfter = 0;
  function checkLock() {
    if (!nativeDiscovery) return false;
    const next = nativeScreenLocked(directory, process.env.DISPLAY || "");
    if (next !== locked) {
      locked = next; epoch++; acceptAfter = Date.now(); latest = null; lastPoint = null;
      destroyWindow();
      if (locked) { try { fs.unlinkSync(owner); } catch {} }
      else if (running) publishNativeOwner(directory, session, process.env.DISPLAY || "");
    }
    return locked;
  }
  function destroyWindow() {
    generation++;
    if (win && !win.isDestroyed()) win.destroy();
    win = null; ready = false; drawn = "";
    clearInterval(animation); animation = null;
  }
  function ensureWindow() {
    if (win && !win.isDestroyed()) return;
    const version = ++generation;
    win = new BrowserWindow({
      width: 320, height: 112, show: false, frame: false, transparent: true,
      focusable: false, skipTaskbar: true, resizable: false, movable: false,
      hasShadow: false, alwaysOnTop: true, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "automation-feedback-preload.cjs"),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false },
    });
    win.setIgnoreMouseEvents(true);
    win.setFocusable(false);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", event => event.preventDefault());
    win.webContents.once("render-process-gone", () => {
      if (version === generation) destroyWindow();
    });
    win.webContents.once("did-finish-load", () => {
      if (version !== generation) return;
      ready = true; safeRender();
    });
    win.loadFile(path.join(__dirname, "automation-feedback.html")).catch(() => {
      if (version === generation) destroyWindow();
    });
    animation = setInterval(safeRender, 33);
    animation.unref?.();
  }
  function safeRender() {
    try { render(); } catch { destroyWindow(); }
  }
  function render() {
    if (checkLock()) return;
    if (!win || win.isDestroyed() || !ready) return;
    const now = Date.now();
    const ttl = latest?.phase === "active" ? 1600 : 1100;
    if (!latest || now - latest.at > ttl) {
      win.hide();
      if (!idleAt) idleAt = now;
      if (now - idleAt > 10000) destroyWindow();
      return;
    }
    idleAt = 0;
    let point;
    // screenToDipPoint is Windows-only. Linux/macOS use Electron's live
    // cursor in DIP coordinates and retain the last point for the done pulse.
    if (platform === "win32" && latest.kind !== "move" && Number.isInteger(latest.x) && Number.isInteger(latest.y)) {
      point = screen.screenToDipPoint ? screen.screenToDipPoint({ x: latest.x, y: latest.y }) : { x: latest.x, y: latest.y };
    } else if (latest.phase === "active" || !lastPoint) {
      try { point = screen.getCursorScreenPoint(); } catch { return; }
    } else point = lastPoint;
    lastPoint = point;
    const display = screen.getDisplayNearestPoint(point);
    const side = display.bounds.x + display.bounds.width - point.x < 160 ? "left" : "right";
    win.setBounds({ x: Math.round(point.x - 160), y: Math.round(point.y - 56), width: 320, height: 112 }, false);
    const signature = latest.id + latest.phase + side;
    if (drawn !== signature) {
      win.webContents.send("automation:feedback", { ...latest, side });
      drawn = signature;
    }
    if (!win.isVisible()) win.showInactive();
  }
  async function poll() {
    if (!running || checkLock() || reading) return;
    const currentEpoch = epoch;
    reading = true;
    try {
      const stat = await fs.promises.stat(file);
      if (stat.size > 1024) return;
      const event = validateFeedback(JSON.parse(await fs.promises.readFile(file, "utf8")), session);
      if (!event || !running || checkLock() || currentEpoch !== epoch || event.at <= acceptAfter) return;
      if (latest?.id !== event.id) lastPoint = null;
      latest = event;
      try { ensureWindow(); safeRender(); } catch { destroyWindow(); }
    } catch { /* atomic replacement/missing file; active feedback expires */ }
    finally { reading = false; }
  }
  return {
    file, session,
    start() { if (!timer) {
      running = true; epoch++; timer = setInterval(poll, 80); timer.unref?.();
      if (nativeDiscovery) {
        const publish = () => { if (!checkLock()) publishNativeOwner(directory, session, process.env.DISPLAY || ""); };
        publish(); ownerTimer = setInterval(publish, 1000); ownerTimer.unref?.();
      }
    } },
    stop() {
      running = false; epoch++;
      clearInterval(timer); timer = null; latest = null; destroyWindow();
      clearInterval(ownerTimer); ownerTimer = null;
      if (owner) { try { fs.unlinkSync(owner); } catch {} }
      try { fs.unlinkSync(file); } catch {}
    },
  };
}
module.exports = { createAutomationFeedback, validateFeedback, nativeFeedbackDirectory, publishNativeOwner, nativeScreenLocked };

