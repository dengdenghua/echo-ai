import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import backendProcess from "./backend-process.cjs";
const { terminateBackendChild } = backendProcess;

describe("backend process ownership", () => {
  it.skipIf(process.platform !== "win32")(
    "Windows shutdown also terminates the owned server descendant",
    async () => {
      const script = `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
    process.stdout.write(child.pid+'\\n');setInterval(()=>{},1000);`;
      const child = spawn(process.execPath, ["-e", script], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const descendant = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("child did not start")),
          5000,
        );
        child.stdout.once("data", (data) => {
          clearTimeout(timer);
          resolve(Number(data.toString().trim()));
        });
        child.once("error", reject);
      });
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        expect(alive(descendant)).toBe(true);
        terminateBackendChild(child);
        for (let attempt = 0; attempt < 40 && alive(descendant); attempt++)
          await new Promise((resolve) => setTimeout(resolve, 50));
        expect(
          alive(descendant),
          "server descendant survived desktop shutdown",
        ).toBe(false);
      } finally {
        if (alive(descendant)) process.kill(descendant);
        if (alive(child.pid)) child.kill();
      }
    },
  );
});
