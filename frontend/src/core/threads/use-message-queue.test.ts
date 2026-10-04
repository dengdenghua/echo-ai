import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executionStorageKey } from "@/core/execution-location";
import { restoreMessageQueue, useMessageQueue } from "./use-message-queue";

function setup(overrides: Partial<Parameters<typeof useMessageQueue>[0]> = {}) {
  const props = {
    scope: "queue-test",
    running: true,
    ready: true,
    blocked: false,
    interrupted: false,
    receipts: new Set<string>(),
    failures: new Map<string, string>(),
    send: vi.fn(),
    discard: vi.fn(),
    ...overrides,
  };
  const view = renderHook((input: typeof props) => useMessageQueue(input), {
    initialProps: props,
  });
  return {
    ...view,
    props,
    update: (next: Partial<typeof props>) => {
      Object.assign(props, next);
      view.rerender({ ...props });
    },
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("message queue", () => {
  it("waits for a settled task and sends in order, one receipt at a time", () => {
    const view = setup();
    act(() => {
      view.result.current.enqueue("first");
      view.result.current.enqueue("second");
    });
    expect(view.props.send).not.toHaveBeenCalled();
    view.update({ running: false });
    expect(view.props.send).toHaveBeenCalledTimes(1);
    expect(view.props.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "first" }),
      "start",
    );
    const firstId = view.result.current.items[0]!.id;
    view.update({ running: true, receipts: new Set([firstId]) });
    expect(view.result.current.items.map((item) => item.text)).toEqual([
      "second",
    ]);
    expect(view.props.send).toHaveBeenCalledTimes(1);
    view.update({ running: false });
    expect(view.props.send).toHaveBeenCalledTimes(2);
    expect(view.props.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "second" }),
      "start",
    );
  });

  it("pauses on interruption and waits for an explicit resume", () => {
    const view = setup();
    act(() => {
      view.result.current.enqueue("follow-up");
    });
    view.update({ running: false, interrupted: true });
    expect(view.result.current.paused).toBe(true);
    expect(view.props.send).not.toHaveBeenCalled();
    act(() => view.result.current.resume());
    expect(view.props.send).toHaveBeenCalledTimes(1);
  });

  it("requires receipts to settle an uncertain send and never auto-replays on reconnect", () => {
    const view = setup({ running: false });
    act(() => {
      view.result.current.enqueue("once");
    });
    const id = view.result.current.items[0]!.id;
    view.update({ ready: false });
    expect(view.result.current.items[0]?.state).toBe("uncertain");
    expect(view.result.current.paused).toBe(true);
    view.update({ ready: true });
    act(() => view.result.current.resume());
    expect(view.props.send).toHaveBeenCalledTimes(1);
    view.update({ receipts: new Set([id]) });
    expect(view.result.current.items).toEqual([]);
  });

  it("keeps failures in place and discards the failed outbound row before explicit retry", () => {
    const view = setup({ running: false });
    act(() => {
      view.result.current.enqueue("retry me");
    });
    const id = view.result.current.items[0]!.id;
    view.update({ failures: new Map([[id, "Rejected"]]) });
    expect(view.result.current.items[0]).toMatchObject({
      state: "failed",
      error: "Rejected",
    });
    act(() => view.result.current.retry(id));
    expect(view.props.discard).toHaveBeenCalledWith(id);
    expect(view.props.send).toHaveBeenCalledTimes(2);
    expect(view.props.send.mock.calls[1]?.[0].id).toBe(id);
    // Retry waits for its receipt rather than starting another delivery.
    expect(view.result.current.items[0]?.state).toBe("sending");
    expect(view.props.send).toHaveBeenCalledTimes(2);
  });

  it("uses a new id after an edit and does not edit or delete an in-flight send", () => {
    const view = setup();
    act(() => {
      view.result.current.enqueue("old");
    });
    const oldId = view.result.current.items[0]!.id;
    act(() => {
      expect(view.result.current.edit(oldId, "new")).toBe(true);
    });
    const newId = view.result.current.items[0]!.id;
    expect(newId).not.toBe(oldId);
    expect(view.result.current.items[0]?.text).toBe("new");
    view.update({ running: false });
    act(() => {
      expect(view.result.current.edit(newId, "another")).toBe(false);
      view.result.current.remove(newId);
    });
    expect(view.result.current.items[0]?.state).toBe("sending");
  });

  it("offers explicit steering only while the current turn is available", () => {
    const view = setup({ blocked: true });
    act(() => {
      view.result.current.enqueue("correction");
    });
    const id = view.result.current.items[0]!.id;
    act(() => view.result.current.steer(id));
    expect(view.props.send).not.toHaveBeenCalled();
    view.update({ blocked: false });
    act(() => view.result.current.steer(id));
    expect(view.props.send).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
      "steer",
    );
  });

  it("restores waiting messages paused and in-flight messages as uncertain", () => {
    const view = setup({ running: false });
    act(() => {
      view.result.current.enqueue("sending");
      view.result.current.enqueue("waiting");
    });
    view.unmount();
    const restored = setup({ running: false });
    expect(restored.result.current.items.map((item) => item.state)).toEqual([
      "uncertain",
      "waiting",
    ]);
    expect(restored.result.current.paused).toBe(true);
    expect(restored.props.send).not.toHaveBeenCalled();
  });

  it("isolates conversations and rejects callbacks captured from an old scope", () => {
    const view = setup({ scope: "one" });
    act(() => {
      view.result.current.enqueue("A");
    });
    const old = view.result.current;
    const id = old.items[0]!.id;
    view.update({ scope: "two" });
    act(() => {
      expect(old.enqueue("stale")).toBe(false);
      old.remove(id);
    });
    expect(view.props.discard).not.toHaveBeenCalled();
    act(() => {
      view.result.current.enqueue("B");
    });
    view.update({ scope: "one" });
    expect(view.result.current.items.map((item) => item.text)).toEqual(["A"]);
    expect(view.result.current.paused).toBe(true);
  });

  it("keeps messages usable when storage fails and bounds malformed snapshots", () => {
    const view = setup();
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    act(() => {
      expect(view.result.current.enqueue("keep in memory")).toBe(true);
    });
    expect(view.result.current.storageUnavailable).toBe(true);
    expect(view.result.current.items).toHaveLength(1);
    spy.mockRestore();
    sessionStorage.setItem(
      executionStorageKey("echo:message-queue:corrupt"),
      JSON.stringify({
        v: 1,
        items: [
          null,
          { id: "itm_queue_ok", text: "ok", state: "waiting" },
          { id: "itm_queue_ok", text: "duplicate", state: "waiting" },
        ],
      }),
    );
    expect(restoreMessageQueue("corrupt").items).toHaveLength(1);
    act(() => {
      for (let i = 0; i < 19; i++)
        expect(view.result.current.enqueue(`item ${i}`)).toBe(true);
      expect(view.result.current.enqueue("too many")).toBe(false);
    });
  });
});
