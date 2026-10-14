import { defineConfig, devices } from "@playwright/test";

// Renderer integration with controlled conversation receipts. No model calls.
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["native-ui.spec.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3327", ...devices["Desktop Chrome"] },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3327 --strictPort",
    url: "http://127.0.0.1:3327",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
