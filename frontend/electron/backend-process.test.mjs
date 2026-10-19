import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import backendProcess from "./backend-process.cjs";
const { terminateBackendChild } = backendProcess;

test(
  "Windows shutdown also terminates the owned server descendant",
  { skip: process.platform !== "win32" },
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
      assert.ok(alive(descendant));
      terminateBackendChild(child);
      for (let attempt = 0; attempt < 40 && alive(descendant); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        alive(descendant),
        false,
        "server descendant survived desktop shutdown",
      );
    } finally {
      if (alive(descendant)) process.kill(descendant);
      if (alive(child.pid)) child.kill();
    }
  },
);
