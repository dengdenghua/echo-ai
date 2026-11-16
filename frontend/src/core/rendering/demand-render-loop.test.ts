import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDemandRenderLoop } from "./demand-render-loop";

let callbacks: Map<number, FrameRequestCallback>;
let nextId: number;

function runFrame(now = 16): void {
  const first = callbacks.entries().next();
  expect(first.done).toBe(false);
  if (first.done) return;
  const [id, callback] = first.value;
  callbacks.delete(id);
  callback(now);
}

describe("createDemandRenderLoop", () => {
  beforeEach(() => {
    callbacks = new Map();
    nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      callbacks.delete(id);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("coalesces invalidations into one paused frame", () => {
    const render = vi.fn();
    const loop = createDemandRenderLoop(render);
    loop.invalidate();
    loop.invalidate();
    expect(callbacks.size).toBe(1);

    runFrame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });

  it("keeps rendering continuously only while playing", () => {
    const render = vi.fn();
    const loop = createDemandRenderLoop(render);
    loop.setPlaying(true);
    runFrame();
    expect(callbacks.size).toBe(1);
    runFrame();
    expect(render).toHaveBeenCalledTimes(2);

    loop.setPlaying(false);
    runFrame();
    expect(callbacks.size).toBe(0);
  });

  it("stops scheduling while inactive and redraws when it returns", () => {
    const render = vi.fn();
    const loop = createDemandRenderLoop(render);
    loop.setPlaying(true);
    loop.setActive(false);
    expect(callbacks.size).toBe(0);

    loop.setActive(true);
    runFrame();
    expect(render).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(1);
  });

  it("never renders after dispose", () => {
    const render = vi.fn();
    const loop = createDemandRenderLoop(render);
    loop.invalidate();
    loop.dispose();
    expect(callbacks.size).toBe(0);
  });
});
