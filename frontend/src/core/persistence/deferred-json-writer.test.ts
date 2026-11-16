import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeferredJsonWriter } from "./deferred-json-writer";

describe("createDeferredJsonWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("serializes only the latest snapshot after the delay", () => {
    const setItem = vi.fn();
    const writer = createDeferredJsonWriter(400, { setItem });
    writer.schedule("canvas:a", { x: 1 });
    writer.schedule("canvas:a", { x: 2 });
    writer.schedule("canvas:a", { x: 3 });

    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith("canvas:a", '{"x":3}');
  });

  it("flushes the queued snapshot immediately and only once", () => {
    const setItem = vi.fn();
    const writer = createDeferredJsonWriter(400, { setItem });
    writer.schedule("canvas:a", { x: 1 });
    writer.flush();
    writer.flush();
    vi.advanceTimersByTime(400);

    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the queued write", () => {
    const setItem = vi.fn();
    const writer = createDeferredJsonWriter(400, { setItem });
    writer.schedule("canvas:a", { x: 1 });
    writer.cancel();
    vi.advanceTimersByTime(400);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("contains quota and serialization failures", () => {
    const writer = createDeferredJsonWriter(0, {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      writer.schedule("canvas:a", circular);
      vi.advanceTimersByTime(0);
    }).not.toThrow();
  });
});
