import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStartupGate } from "./use-startup-gate";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("never polls or blocks web and development sessions", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(false));
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(result.current.visible).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("dismisses the startup card permanently after the first successful probe", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(result.current.visible).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(result.current.visible).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1100));
  expect(result.current.visible).toBe(false);
  fetch.mockResolvedValue({ ok: false });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current.visible).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("skips the startup card entirely when the first probe succeeds", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true })
    .mockRejectedValue(new Error("busy"));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(result.current.visible).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps one stable startup card while the service is genuinely starting", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("not started"));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  await act(() => vi.advanceTimersByTimeAsync(400));
  expect(result.current.visible).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(result.current.visible).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(7);
});

it("waits for a pending probe instead of starting overlapping requests", async () => {
  let finish: ((response: { ok: boolean }) => void) | undefined;
  const fetch = vi.fn(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish?.({ ok: true }));
  expect(result.current.visible).toBe(false);
});

it("aborts and ignores late probe results after unmount", async () => {
  let signal: AbortSignal | undefined;
  let finish: ((response: { ok: boolean }) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options: RequestInit) => {
      signal = options.signal ?? undefined;
      return new Promise<{ ok: boolean }>((resolve) => {
        finish = resolve;
      });
    }),
  );
  const { unmount } = renderHook(() => useStartupGate(true));
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish?.({ ok: false }));
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // AbortSignal timeout belongs to the platform.
});

it("cleans up StrictMode's discarded startup probe", async () => {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url, options: RequestInit) => {
    if (options.signal) signals.push(options.signal);
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true), {
    wrapper: StrictMode,
  });
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(signals[0]?.aborted).toBe(true);
  expect(result.current.visible).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("offers recovery after a slow start without resetting the visible notice", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  await act(() => vi.advanceTimersByTimeAsync(12_100));
  expect(result.current.slow).toBe(true);
  expect(result.current.visible).toBe(true);
  const attempts = fetch.mock.calls.length;
  fetch.mockResolvedValue({ ok: true });
  await act(async () => result.current.retry());
  expect(fetch).toHaveBeenCalledTimes(attempts + 1);
  expect(result.current.visible).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).toHaveBeenCalledTimes(attempts + 1);
});

it("does not start a second probe when retry is requested during an active check", async () => {
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useStartupGate(true));
  expect(result.current.checking).toBe(true);
  await act(async () => result.current.retry());
  expect(fetch).toHaveBeenCalledTimes(1);
});
