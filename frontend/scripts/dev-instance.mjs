import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { delimiter, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const SCHEMA = "echo.dev-instance.v1";
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};
function canonicalPath(path) {
  let value = resolve(path);
  if (existsSync(value)) value = realpathSync(value);
  value = value.replaceAll("\\", "/").replace(/\/$/, "");
  return process.platform === "win32" ? value.toLowerCase() : value;
}
export function devIdentity(root, dataRoot) {
  const project = canonicalPath(root);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  return {
    schema: SCHEMA,
    projectId: hash(project),
    instanceId: hash(project + "\0" + canonicalPath(dataRoot)),
  };
}
export function devSettings(root, kind, env = process.env) {
  root = resolve(root);
  const copied = /^e:\/agent\//i.test(root.replaceAll("\\", "/"));
  const defaults =
    kind === "os"
      ? copied
        ? [18000, 13000, 28765]
        : [8000, 3000, 8765]
      : copied
        ? [18310, 13310, 18765]
        : [8310, 3310, 8765];
  const localUrlPort = (value) => {
    try {
      const url = new URL(value);
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        return url.port || (url.protocol === "https:" ? 443 : 80);
    } catch {
      /* Invalid explicit URLs are reported by preflight. */
    }
    return null;
  };
  const readPort = (name, fallback) => {
    const value = String(env[name] || fallback);
    if (!/^\d+$/.test(value) || +value < 1 || +value > 65535)
      throw new Error(name + " must be a TCP port between 1 and 65535");
    return +value;
  };
  const ports = {
    backend: readPort(
      "GATEWAY_PORT",
      localUrlPort(
        env.ECHO_BACKEND_URL || env.ECHO_INTERNAL_GATEWAY_BASE_URL,
      ) || defaults[0],
    ),
    frontend: readPort(
      "FRONTEND_PORT",
      localUrlPort(env.ELECTRON_START_URL) ||
        (kind === "ai" ? env.PORT || defaults[1] : defaults[1]),
    ),
    tentacle: readPort(
      "ECHO_TENTACLE_WS_PORT",
      kind === "os" ? env.ECHO_DEVICE_LINK_PORT || defaults[2] : defaults[2],
    ),
  };
  if (new Set(Object.values(ports)).size !== 3)
    throw new Error("Backend, frontend and Tentacle ports must differ");
  const homeRoot = resolve(
    env.ECHO_HOME ||
      resolve(root, kind === "ai" ? ".codex-run/echo" : ".echo-home"),
  );
  const dataRoot = resolve(
    env.ECHO_DEV_DATA_DIR ||
      env.ECHO_DATA_DIR ||
      (env.ECHO_HOME || kind === "ai"
        ? resolve(homeRoot, "data")
        : resolve(root, "data/echo-appliance-dev")),
  );
  const configPath = env.ECHO_AGENT_CONFIG
    ? resolve(env.ECHO_AGENT_CONFIG)
    : resolve(
        root,
        isFile(resolve(root, "config.local.yaml"))
          ? "config.local.yaml"
          : "config.example.yaml",
      );
  const python = env.ECHO_AGENT_PYTHON
    ? resolve(env.ECHO_AGENT_PYTHON)
    : [
        resolve(root, ".venv/Scripts/python.exe"),
        resolve(root, ".venv/bin/python"),
      ].find(isFile);
  return {
    root,
    frontendRoot: resolve(root, "frontend"),
    kind,
    ports,
    homeRoot,
    dataRoot,
    configPath,
    python,
    identity: devIdentity(root, dataRoot),
  };
}
export function devEnvironment(settings, env = process.env) {
  const extensions = [
    ...new Set(
      (env.ECHO_APP_EXTENSIONS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .concat("tools.dev_instance"),
    ),
  ].join(",");
  // Packaged builds pin the vetted Codex bundle via ECHO_CODEX_EXECUTABLE. Do
  // the same in source runs once `pnpm codex:prepare:*` has produced it:
  // other Codex builds (PATH, the Codex desktop app) enable features Echo's
  // effective-config check rejects. An explicit setting always wins.
  const bundledCodex = resolve(
    settings.root,
    "extras/desktop/build/codex/bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
  const codexEnv =
    !env.ECHO_CODEX_EXECUTABLE && isFile(bundledCodex)
      ? { ECHO_CODEX_EXECUTABLE: bundledCodex }
      : {};
  return {
    ...env,
    ...codexEnv,
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: [settings.root, env.PYTHONPATH].filter(Boolean).join(delimiter),
    ECHO_HOME: settings.homeRoot,
    ECHO_DATA_DIR: settings.dataRoot,
    ECHO_DEV_DATA_DIR: settings.dataRoot,
    ECHO_DEV_INSTANCE: "1",
    ECHO_APP_EXTENSIONS: extensions,
    GATEWAY_PORT: String(settings.ports.backend),
    FRONTEND_PORT: String(settings.ports.frontend),
    ECHO_TENTACLE_WS_PORT: String(settings.ports.tentacle),
    ...(settings.kind === "os"
      ? {
          ECHO_DEVICE_LINK_PORT:
            env.ECHO_DEVICE_LINK_PORT || String(settings.ports.tentacle),
        }
      : {}),
    ECHO_BACKEND_URL:
      env.ECHO_BACKEND_URL || `http://127.0.0.1:${settings.ports.backend}`,
    ECHO_INTERNAL_GATEWAY_BASE_URL:
      env.ECHO_INTERNAL_GATEWAY_BASE_URL ||
      `http://127.0.0.1:${settings.ports.backend}`,
    ELECTRON_START_URL:
      env.ELECTRON_START_URL || `http://127.0.0.1:${settings.ports.frontend}`,
  };
}
export function inspectDevSetup(settings, env = process.env) {
  const errors = [];
  if (
    settings.kind === "os" &&
    env.ECHO_DEVICE_LINK_PORT &&
    String(settings.ports.tentacle) !== env.ECHO_DEVICE_LINK_PORT
  )
    errors.push("ECHO_DEVICE_LINK_PORT conflicts with ECHO_TENTACLE_WS_PORT");
  for (const [name, port] of [
    ["ECHO_BACKEND_URL", settings.ports.backend],
    ["ECHO_INTERNAL_GATEWAY_BASE_URL", settings.ports.backend],
    ["ELECTRON_START_URL", settings.ports.frontend],
  ]) {
    if (!env[name]) continue;
    try {
      const url = new URL(env[name]);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        +(url.port || (url.protocol === "https:" ? 443 : 80)) !== port ||
        url.username ||
        url.password
      )
        errors.push(name + " must point to the selected local instance port");
    } catch {
      errors.push(name + " must be a local HTTP URL");
    }
  }
  if (!isFile(settings.configPath))
    errors.push("Development config is missing");
  let python = null;
  if (!settings.python || !isFile(settings.python))
    errors.push("Development Python is missing; set ECHO_AGENT_PYTHON");
  else {
    const script =
      "import importlib.util,json,sys,runtime; print(json.dumps({'runtimeFile':runtime.__file__,'python':sys.executable,'version':list(sys.version_info[:2]),'dependencies':{name:importlib.util.find_spec(name) is not None for name in ['fastapi','uvicorn','yaml','pydantic']}}))";
    const result = spawnSync(settings.python, ["-B", "-c", script], {
      cwd: settings.root,
      env: devEnvironment(settings, env),
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    try {
      if (result.status !== 0) throw new Error("Python import probe failed");
      python = JSON.parse(result.stdout.trim());
      if (
        canonicalPath(dirname(dirname(python.runtimeFile))) !==
        canonicalPath(settings.root)
      )
        errors.push("Python imports runtime from a different checkout");
      if (python.version[0] !== 3 || python.version[1] < 11)
        errors.push("Python 3.11+ is required");
      for (const [name, present] of Object.entries(python.dependencies))
        if (!present) errors.push("Python dependency is missing: " + name);
    } catch {
      errors.push(
        "Python import probe failed; rebuild .venv or set ECHO_AGENT_PYTHON",
      );
    }
  }
  const entries = {};
  const require = createRequire(resolve(settings.frontendRoot, "package.json"));
  for (const [name, relative] of [
    ["vite", "bin/vite.js"],
    ["typescript", "bin/tsc"],
    ["vitest", "vitest.mjs"],
  ]) {
    try {
      const entry = resolve(
        dirname(require.resolve(name + "/package.json")),
        relative,
      );
      if (!isFile(entry)) throw new Error("missing");
      if (
        !canonicalPath(entry).startsWith(
          canonicalPath(settings.frontendRoot) + "/",
        )
      )
        throw new Error("outside checkout");
      entries[name] = entry;
    } catch {
      errors.push(
        "Frontend dependency is missing or points outside this checkout: " +
          name,
      );
    }
  }
  return {
    check: "development-instance-preflight",
    ok: errors.length === 0,
    projectRoot: settings.root,
    dataRoot: settings.dataRoot,
    homeRoot: settings.homeRoot,
    configPath: settings.configPath,
    ports: settings.ports,
    identity: settings.identity,
    python,
    entries,
    errors,
  };
}
export function assertPortFree(port) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(new Error(`Port ${port} is occupied; no process was killed`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}
function readJson(port, path, timeoutMs = 2000) {
  return new Promise((resolvePromise, reject) => {
    const request = http.get(
      { host: "127.0.0.1", port, path, agent: false },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(path + ": HTTP " + response.statusCode));
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536)
            request.destroy(new Error("Identity response too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolvePromise(JSON.parse(body));
          } catch {
            reject(new Error("Invalid identity JSON"));
          }
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("Local identity probe timed out")),
      timeoutMs,
    );
    request.on("close", () => clearTimeout(timer));
    request.on("error", reject);
  });
}
export async function probeOwnedService(
  port,
  identity,
  { frontend = false, timeoutMs = 2000 } = {},
) {
  try {
    const observed = await readJson(
      port,
      frontend ? "/__echo_dev_instance" : "/api/dev/instance",
      timeoutMs,
    );
    if (
      observed?.schema !== SCHEMA ||
      observed.projectId !== identity.projectId ||
      observed.instanceId !== identity.instanceId
    )
      throw new Error("Service belongs to another checkout or state directory");
    const proxied = frontend
      ? await readJson(port, "/api/dev/instance", timeoutMs)
      : observed;
    if (
      proxied.projectId !== identity.projectId ||
      proxied.instanceId !== identity.instanceId
    )
      throw new Error("Frontend proxy points to another instance");
    const health = await readJson(port, "/api/health", timeoutMs);
    if (
      health?.status !== "ok" ||
      health?.runtime?.name !== "echo-ai-runtime"
    )
      throw new Error("Echo runtime is not healthy");
    return {
      ready: true,
      restartRequired: health.lifecycle?.restartRequired === true,
    };
  } catch (error) {
    return { ready: false, error: error.code || error.message };
  }
}
export async function waitForOwnedService(port, identity, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 120000);
  let last;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    last = await probeOwnedService(port, identity, {
      ...options,
      timeoutMs: Math.min(2000, deadline - Date.now()),
    });
    if (last.ready) {
      if (last.restartRequired)
        throw new Error("Source changes require restart");
      return last;
    }
    await delay(
      Math.min(options.intervalMs || 500, Math.max(1, deadline - Date.now())),
      undefined,
      { signal: options.signal },
    );
  }
  throw new Error(`Echo on port ${port} did not become ready: ${last?.error}`);
}
export async function inspectDevPorts(settings) {
  const entries = await Promise.all(
    ["backend", "frontend", "tentacle"].map(async (name) => {
      const port = settings.ports[name];
      try {
        await assertPortFree(port);
        return [name, { port, state: "free" }];
      } catch {
        if (name !== "tentacle") {
          const own = await probeOwnedService(port, settings.identity, {
            frontend: name === "frontend",
          });
          if (own.ready) return [name, { port, state: "owned", ...own }];
        }
        return [name, { port, state: "occupied" }];
      }
    }),
  );
  return Object.fromEntries(entries);
}
export function devInstancePlugin(kind) {
  return {
    name: "echo-development-instance",
    apply: "serve",
    configureServer(server) {
      const settings = devSettings(resolve(server.config.root, ".."), kind);
      server.middlewares.use((req, res, next) => {
        if (
          req.method !== "GET" ||
          req.url?.split("?")[0] !== "/__echo_dev_instance"
        )
          return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(settings.identity));
      });
    },
  };
}
