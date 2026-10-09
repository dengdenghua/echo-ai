import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  devIdentity,
  devSettings,
  devEnvironment,
  inspectDevSetup,
  assertPortFree,
  probeOwnedService,
  waitForOwnedService,
  devInstancePlugin,
} from "./dev-instance.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("ECHO_") &&
      !["GATEWAY_PORT", "FRONTEND_PORT", "PORT", "ELECTRON_START_URL"].includes(
        key,
      ),
  ),
);
const kind = "ai";
const healthy = { status: "ok", runtime: { name: "echo-ai-runtime" } };
const expected = devIdentity(root, resolve(root, "isolated-test-state"));
function json(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return server.address().port;
}
test("original defaults are preserved and copied projects get separate listeners", () => {
  const original = devSettings(tmpdir(), kind, {});
  assert.deepEqual(
    original.ports,
    kind === "os"
      ? { backend: 8000, frontend: 3000, tentacle: 8765 }
      : { backend: 8310, frontend: 3310, tentacle: 8765 },
  );
  if (process.platform === "win32") {
    const copied = devSettings(`E:/AGENT/echo-${kind}`, kind, {});
    assert.deepEqual(
      copied.ports,
      kind === "os"
        ? { backend: 18000, frontend: 13000, tentacle: 28765 }
        : { backend: 18310, frontend: 13310, tentacle: 18765 },
    );
  }
});
test("explicit ports and independent user state are honoured", () => {
  const state = resolve(tmpdir(), "echo-explicit-state");
  const settings = devSettings(root, kind, {
    GATEWAY_PORT: "42001",
    FRONTEND_PORT: "42002",
    ECHO_TENTACLE_WS_PORT: "42003",
    ECHO_DATA_DIR: state,
  });
  assert.deepEqual(settings.ports, {
    backend: 42001,
    frontend: 42002,
    tentacle: 42003,
  });
  assert.equal(settings.dataRoot, state);
  const env = devEnvironment(settings, {
    PYTHONPATH: "existing-path",
    ECHO_APP_EXTENSIONS: "existing.extension",
  });
  assert.ok(env.PYTHONPATH.startsWith(root));
  assert.ok(env.ECHO_APP_EXTENSIONS.includes("existing.extension"));
  assert.ok(env.ECHO_APP_EXTENSIONS.includes("tools.dev_instance"));
  assert.equal(env.ECHO_DATA_DIR, state);
  if (kind === "os") assert.equal(env.ECHO_DEVICE_LINK_PORT, "42003");
  assert.throws(() => devSettings(root, kind, { GATEWAY_PORT: "42x" }));
  assert.throws(() =>
    devSettings(root, kind, { GATEWAY_PORT: "42001", FRONTEND_PORT: "42001" }),
  );
});
test("explicit local URLs select their ports without silently retaining another instance", () => {
  const settings = devSettings(root, kind, {
    ECHO_BACKEND_URL: "http://localhost:42004",
    ELECTRON_START_URL: "http://127.0.0.1:42005",
  });
  assert.equal(settings.ports.backend, 42004);
  assert.equal(settings.ports.frontend, 42005);
});
test("actual Python import comes from this checkout and agrees with opaque identity", () => {
  const settings = devSettings(root, kind, cleanEnv);
  const result = spawnSync(
    settings.python,
    [
      "-B",
      "-c",
      "import json,runtime; from tools.dev_instance import development_identity; print(json.dumps({'file':runtime.__file__,'identity':development_identity()}))",
    ],
    {
      cwd: settings.frontendRoot,
      env: devEnvironment(settings, cleanEnv),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.file.toLowerCase().startsWith(root.toLowerCase()));
  assert.deepEqual(report.identity, settings.identity);
});
test("matching service can be reused while occupied sockets are never killed", async (t) => {
  const port = await fixture(t, (req, res) => {
    assert.equal(req.headers.cookie, undefined);
    json(res, req.url === "/api/health" ? healthy : expected);
  });
  assert.deepEqual(await probeOwnedService(port, expected), {
    ready: true,
    restartRequired: false,
  });
  await assert.rejects(assertPortFree(port), /occupied/);
  assert.equal((await probeOwnedService(port, expected)).ready, true);
});
test("a healthy service from another checkout or state cannot be reused", async (t) => {
  for (const other of [
    { ...expected, projectId: "different" },
    { ...expected, instanceId: "different" },
  ]) {
    const port = await fixture(t, (req, res) =>
      json(res, req.url === "/api/health" ? healthy : other),
    );
    const mismatch = await probeOwnedService(port, expected);
    assert.equal(mismatch.ready, false);
    assert.match(mismatch.error, /another checkout/);
    await assert.rejects(
      waitForOwnedService(port, expected, { timeoutMs: 30, intervalMs: 5 }),
      /did not become ready/,
    );
  }
});
test("frontend must identify itself and proxy the same backend instance", async (t) => {
  const port = await fixture(t, (req, res) =>
    json(
      res,
      req.url === "/api/health"
        ? healthy
        : req.url === "/__echo_dev_instance"
          ? expected
          : { ...expected, instanceId: "other-backend" },
    ),
  );
  assert.equal(
    (await probeOwnedService(port, expected, { frontend: true })).ready,
    false,
  );
});
test("redirected identity and unbounded responses cannot impersonate a service", async (t) => {
  let redirectHits = 0;
  const port = await fixture(t, (req, res) => {
    if (req.url === "/redirected") redirectHits++;
    res.writeHead(302, { Location: "/redirected" });
    res.end();
  });
  assert.equal((await probeOwnedService(port, expected)).ready, false);
  assert.equal(redirectHits, 0);
  const oversized = await fixture(t, (_req, res) => res.end("x".repeat(70000)));
  assert.equal((await probeOwnedService(oversized, expected)).ready, false);
});
test("Vite ownership is derived from its actual source root", () => {
  let middleware;
  devInstancePlugin(kind).configureServer({
    config: { root: resolve(root, "frontend") },
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  let body;
  middleware(
    { method: "GET", url: "/__echo_dev_instance" },
    {
      setHeader() {},
      end(value) {
        body = JSON.parse(value);
      },
    },
    () => assert.fail("identity request passed through"),
  );
  assert.deepEqual(body, devSettings(root, kind).identity);
});
test("preflight reports URL conflicts without exposing credentials", () => {
  const settings = devSettings(root, kind, cleanEnv);
  const report = inspectDevSetup(settings, {
    ...cleanEnv,
    ECHO_BACKEND_URL: "http://localhost:1",
    ECHO_LOCAL_JWT_SECRET: "must-not-appear",
  });
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some((error) =>
      error.includes("selected local instance port"),
    ),
  );
  assert.equal(JSON.stringify(report).includes("must-not-appear"), false);
});
