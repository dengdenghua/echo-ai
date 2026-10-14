import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve("@playwright/test/cli"),
    "test",
    "--config",
    "playwright.full.config.ts",
    ...process.argv.slice(2),
  ],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "inherit",
    env: {
      ...process.env,
      ECHO_E2E_COLLAB: "1",
      ECHO_E2E_CONFIG: "frontend/e2e/config.collaboration.yaml",
      ECHO_E2E_TEST_MATCH: "group-collaboration.spec.ts",
      ECHO_E2E_STATE_ROOT: "test-results/collaboration-state",
      ECHO_E2E_JSON_REPORT: "../test-results/collaboration-browser.json",
      ECHO_E2E_REUSE_SERVER: "0",
      ECHO_ENV: "development",
      ECHO_E2E_JWT_SECRET: `${randomBytes(32).toString("base64url")}Az7!`,
      FRONTEND_PORT: process.env.FRONTEND_PORT || "13220",
      GATEWAY_PORT: process.env.GATEWAY_PORT || "18220",
    },
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
