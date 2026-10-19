"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

// A frozen Python executable owns a bootloader and a server child on Windows.
// Terminating only the bootloader leaves the server holding its port and its
// previous desktop session credentials across the next application launch.
function terminateBackendChild(child) {
  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    const taskkill = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const result = spawnSync(
      taskkill,
      ["/PID", String(child.pid), "/T", "/F"],
      {
        windowsHide: true,
        stdio: "ignore",
        timeout: 5000,
      },
    );
    if (!result.error && result.status === 0) return;
  }
  child.kill();
}

module.exports = { terminateBackendChild };
