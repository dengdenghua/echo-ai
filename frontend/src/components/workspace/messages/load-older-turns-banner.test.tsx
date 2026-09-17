import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { renderWithProviders } from "@/test/harness";

import { LoadOlderTurnsBanner } from "./load-older-turns-banner";

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let ioCallback: IOCallback | null = null;

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    ioCallback = callback as unknown as IOCallback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function emitIntersecting(isIntersecting: boolean) {
  act(() => {
    ioCallback?.([{ isIntersecting }]);
  });
}

describe("LoadOlderTurnsBanner", () => {
  beforeEach(() => {
    ioCallback = null;
    // The global test setup predefines a writable IntersectionObserver
    // mock; swap in one that captures the callback for manual dispatch.
    window.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  it("loads older turns on manual click", async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoadOlderTurnsBanner onLoad={onLoad} />, {
      locale: "zh-CN",
    });

    fireEvent.click(screen.getByRole("button"));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("does not auto-load when visible before the user scrolls", () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoadOlderTurnsBanner onLoad={onLoad} />, {
      locale: "zh-CN",
    });

    emitIntersecting(true);
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("auto-loads when scrolled into view after user scroll", async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoadOlderTurnsBanner onLoad={onLoad} />, {
      locale: "zh-CN",
    });

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    emitIntersecting(true);
    expect(onLoad).toHaveBeenCalledTimes(1);

    // No repeat while the banner stays in view: it must leave and
    // re-enter before the next automatic page.
    emitIntersecting(true);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});
