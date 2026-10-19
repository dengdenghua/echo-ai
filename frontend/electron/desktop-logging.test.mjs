import { test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("packaged logs survive a closed launcher output pipe", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "echo-log-"));
  const modulePath = fileURLToPath(
    new URL("./desktop-logging.cjs", import.meta.url),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const fs = require('node:fs');
      const logging = require(${JSON.stringify(modulePath)});
      process.stdout.write = process.stderr.write = () => {
        throw Object.assign(new Error('broken launcher pipe'), {code:'EPIPE'});
      };
      logging.installDesktopLogging(${JSON.stringify(directory)});
      console.warn('proxy unavailable');
      const fd = logging.openDesktopLog(${JSON.stringify(directory)}, 'backend.log');
      const child = require('node:child_process').spawnSync(process.execPath,
        ['-e', "console.log('backend ready')"], {stdio:['ignore',fd,fd]});
      fs.closeSync(fd);
      if (child.status !== 0) process.exitCode = 1;
    `,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readFileSync(path.join(directory, "logs/desktop.log"), "utf8"),
      /proxy unavailable/,
    );
    assert.match(
      readFileSync(path.join(directory, "logs/backend.log"), "utf8"),
      /backend ready/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
