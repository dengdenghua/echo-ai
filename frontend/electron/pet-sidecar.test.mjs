import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

describe("pet sidecar packaging guard", () => {
  it("a packaged pet directory without its binary stays disabled", () => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "echo-pet-test-"));
    fs.mkdirSync(path.join(resources, "pet-sidecar"));
    try {
      const source = fs.readFileSync(
        new URL("./pet-sidecar.cjs", import.meta.url),
        "utf8",
      );
      const module = { exports: {} };
      vm.runInNewContext(source, {
        module,
        process: { platform: "win32", env: {}, resourcesPath: resources },
        console: { warn() {} },
        require(name) {
          if (name === "electron") return { app: { isPackaged: true } };
          if (name === "child_process")
            return {
              spawn() {
                throw new Error("must not execute a project directory");
              },
            };
          return require(name);
        },
      });
      expect(module.exports.startPet().ok).toBe(false);
      expect(module.exports.isPetRunning()).toBe(false);
    } finally {
      fs.rmSync(resources, { recursive: true, force: true });
    }
  });
});
