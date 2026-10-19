"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Console } = require("node:console");

// A GUI launcher's stdout can disappear as soon as its terminal exits.
// Packaged processes must own their logs instead of inheriting that pipe.
function openDesktopLog(userData, name) {
  const directory = path.join(userData, "logs");
  fs.mkdirSync(directory, { recursive: true });
  return fs.openSync(path.join(directory, name), "a", 0o600);
}

function installDesktopLogging(userData) {
  const fd = openDesktopLog(userData, "desktop.log");
  const stream = fs.createWriteStream(null, { fd, autoClose: false });
  global.console = new Console({ stdout: stream, stderr: stream });
}

module.exports = { openDesktopLog, installDesktopLogging };
