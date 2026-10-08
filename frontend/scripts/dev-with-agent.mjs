import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  devSettings,
  devEnvironment,
  inspectDevSetup,
  assertPortFree,
  probeOwnedService,
  waitForOwnedService,
} from "./dev-instance.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
if (process.argv.includes("--example"))
  process.env.ECHO_AGENT_CONFIG = fileURLToPath(
    new URL("../../config.example.yaml", import.meta.url),
  );
const settings = devSettings(root, "ai");
if (process.argv.includes("--check")) {
  await import("./dev-preflight.mjs");
} else {
  const report = inspectDevSetup(settings);
  if (!report.ok) throw new Error(report.errors.join("; "));
  const env = devEnvironment(settings);
  const children = new Set();
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await Promise.all(
      [...children].map(async (child) => {
        if (!child.pid || child.exitCode !== null) return;
        if (process.platform === "win32")
          await promisify(execFile)(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true },
          ).catch(() => {});
        else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            /* owned child already exited */
          }
        }
      }),
    );
  }
  function launch(executable, args, cwd) {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    children.add(child);
    child.once("error", async (error) => {
      console.error(error.message);
      process.exitCode = 1;
      await stop();
    });
    child.once("exit", async (code) => {
      if (!stopping) {
        process.exitCode = code || 1;
        await stop();
      }
    });
    return child;
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  try {
    const backend = await probeOwnedService(
      settings.ports.backend,
      settings.identity,
    );
    if (!backend.ready) {
      await Promise.all([
        assertPortFree(settings.ports.backend),
        assertPortFree(settings.ports.tentacle),
      ]);
      launch(
        settings.python,
        [
          "-m",
          "runtime",
          "serve",
          "--config",
          settings.configPath,
          "--host",
          "127.0.0.1",
          "--port",
          String(settings.ports.backend),
        ],
        settings.root,
      );
    }
    await waitForOwnedService(settings.ports.backend, settings.identity);
    const frontend = await probeOwnedService(
      settings.ports.frontend,
      settings.identity,
      { frontend: true },
    );
    if (!frontend.ready) {
      await assertPortFree(settings.ports.frontend);
      launch(
        process.execPath,
        [
          report.entries.vite,
          "--host",
          "127.0.0.1",
          "--port",
          String(settings.ports.frontend),
          "--strictPort",
        ],
        settings.frontendRoot,
      );
    }
    await waitForOwnedService(settings.ports.frontend, settings.identity, {
      frontend: true,
      timeoutMs: 30000,
    });
    console.info(
      `[echo] Ready: http://127.0.0.1:${settings.ports.frontend} · checkout, state and proxy verified`,
    );
    if (process.argv.includes("--electron")) {
      const require = createRequire(
        resolve(settings.frontendRoot, "package.json"),
      );
      const electronCli = resolve(
        dirname(require.resolve("electron/package.json")),
        "cli.js",
      );
      launch(
        process.execPath,
        [electronCli, resolve(settings.frontendRoot, "electron/main.cjs")],
        settings.frontendRoot,
      );
    }
  } catch (error) {
    console.error("[echo] " + error.message);
    process.exitCode = 1;
    await stop();
  }
}
