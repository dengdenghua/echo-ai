import { defineConfig } from "@playwright/test";
import nativeConfig from "./playwright.native-ui.config";

export default defineConfig({
  ...nativeConfig,
  testMatch: ["startup-status.spec.ts"],
  // The first visit compiles the real styles and locale modules in Vite.
  // Leave startup headroom beyond the UI assertions on cold Windows runners.
  timeout: 90_000,
});
