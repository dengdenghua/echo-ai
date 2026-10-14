import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: ["organizations.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/organizations-results.json" }],
  ],
  use: { ...base.use, baseURL: "http://127.0.0.1:3337" },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3337`,
    url: "http://127.0.0.1:3337",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
