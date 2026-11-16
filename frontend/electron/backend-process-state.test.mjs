import { test } from "vitest";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import stateModule from "./backend-process-state.cjs";

const child = () =>
  Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });

test("a slow spawn remains starting until a live child is returned", async () => {
  let finish;
  const backend = stateModule.manageBackend({
    spawnBackend: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    killBackend() {},
  });
  const pending = backend.start();
  assert.deepEqual(backend.getStatus(), { state: "starting" });
  finish(child());
  await pending;
  assert.deepEqual(backend.getStatus(), { state: "running" });
});

test("only process failure changes the state to failed", async () => {
  const process = child();
  const backend = stateModule.manageBackend({
    spawnBackend: async () => process,
    killBackend() {},
  });
  await backend.start();
  process.emit("exit", 7);
  assert.deepEqual(backend.getStatus(), {
    state: "failed",
    reason: "process-exit",
    exitCode: 7,
  });
});

test("spawn rejection and an already exited child are recorded", async () => {
  const backend = stateModule.manageBackend({
    spawnBackend: async () => {
      throw new Error("failed");
    },
    killBackend() {},
  });
  await assert.rejects(backend.start());
  assert.equal(backend.getStatus().reason, "spawn-error");
  const exited = stateModule.manageBackend({
    spawnBackend: async () => Object.assign(child(), { exitCode: 1 }),
    killBackend() {},
  });
  await exited.start();
  assert.equal(exited.getStatus().state, "failed");
});

test("restart ignores exit events from the terminated generation", async () => {
  const old = child();
  const next = child();
  let calls = 0;
  const backend = stateModule.manageBackend({
    spawnBackend: async () => (calls++ === 0 ? old : next),
    killBackend: () => old.emit("exit", 1),
  });
  await backend.start();
  await backend.restart();
  old.emit("error", new Error("late error"));
  assert.deepEqual(backend.getStatus(), { state: "running" });
  next.emit("error", new Error("actual failure"));
  assert.equal(backend.getStatus().reason, "spawn-error");
});

test("a stale asynchronous spawn cannot overwrite the replacement state", async () => {
  let finish;
  let calls = 0;
  const backend = stateModule.manageBackend({
    spawnBackend: () =>
      calls++ === 0
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(child()),
    killBackend() {},
  });
  const old = backend.start();
  await backend.restart();
  finish(Object.assign(child(), { exitCode: 1 }));
  await old;
  assert.deepEqual(backend.getStatus(), { state: "running" });
});
