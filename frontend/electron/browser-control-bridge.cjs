"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const ACTIONS = new Set([
  "navigate",
  "click",
  "type",
  "scroll",
  "wait",
  "state",
  "extract",
  "screenshot",
  "current-url",
  "execute-js",
]);

// A private loopback transport. The host owns target selection and execution;
// callers cannot choose arbitrary webContents. Script execution, like every
// other registered live-browser tool, remains confined to the selected webview.
async function startBrowserControlBridge({ statePath, getTarget, runAction }) {
  const token = randomBytes(32).toString("hex");
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (req.headers.authorization !== `Bearer ${token}`) {
      send(401, { ok: false, error: "unauthorized" });
      return;
    }
    if (req.method !== "POST" || req.headers.origin) {
      send(403, { ok: false, error: "local host requests only" });
      return;
    }
    const action = req.url.slice(1);
    if (action !== "status" && !ACTIONS.has(action)) {
      send(404, { ok: false, error: "unsupported action" });
      return;
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) {
          send(413, { ok: false, error: "request too large" });
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let params;
      try {
        params = body ? JSON.parse(body) : {};
      } catch {
        send(400, { ok: false, error: "invalid JSON" });
        return;
      }
      if (
        !params ||
        Array.isArray(params) ||
        typeof params !== "object" ||
        "webContentsId" in params
      ) {
        send(400, { ok: false, error: "invalid parameters" });
        return;
      }
      const target = getTarget();
      if (action === "status") {
        send(200, {
          ok: true,
          activeWebContentsId: target?.id ?? null,
          pid: process.pid,
        });
      } else if (!target) {
        send(503, { ok: false, error: "no active browser tab" });
      } else {
        send(200, await runAction(target, action, params));
      }
    } catch {
      if (!res.headersSent)
        send(500, { ok: false, error: "browser action failed" });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({ port: server.address().port, token, pid: process.pid }),
      { mode: 0o600 },
    );
    fs.chmodSync(statePath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    close() {
      server.close();
      server.closeAllConnections();
      try {
        // Another instance may have replaced the discovery file.
        if (JSON.parse(fs.readFileSync(statePath, "utf8")).token === token)
          fs.unlinkSync(statePath);
      } catch {
        /* already removed */
      }
    },
  };
}

module.exports = { startBrowserControlBridge };
