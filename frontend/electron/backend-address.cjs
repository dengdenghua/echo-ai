"use strict";

const { normalizeLoopbackBackendBaseURL } = require("./desktop-protocol.cjs");

function backendBaseURL(packaged, override) {
  // The installed desktop owns its backend and credentials. Development's
  // service on 8310 must not prevent a normal shortcut launch from starting.
  return normalizeLoopbackBackendBaseURL(
    override || `http://127.0.0.1:${packaged ? 18310 : 8310}`,
  );
}

function backendPort(packaged, override) {
  const url = new URL(backendBaseURL(packaged, override));
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

module.exports = { backendBaseURL, backendPort };
