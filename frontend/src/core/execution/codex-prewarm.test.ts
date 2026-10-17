import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  prewarmCodex,
  resetCodexPrewarm,
  useCodexPrewarm,
} from "./codex-prewarm";
import { PREWARM_RENEW_MS } from "./opencode-prewarm";

const apiPost = vi.hoisted(() => vi.fn(() => Promise.resolve({ warm: true })));

vi.mock("@/core/api/request", () => ({ apiPost }));

describe("Codex prewarm", () => {
  afterEach(() => {
    apiPost.mockClear();
    resetCodexPrewarm();
  });

  it("asks once inside the renew window", () => {
    prewarmCodex(0);
    prewarmCodex(PREWARM_RENEW_MS - 1);
    prewarmCodex(PREWARM_RENEW_MS);
    expect(apiPost.mock.calls).toEqual([
      ["/api/codex/prewarm"],
      ["/api/codex/prewarm"],
    ]);
  });

  it("warms only conversations that run on Codex and can reply", () => {
    renderHook(() => useCodexPrewarm("opencode"));
    renderHook(() => useCodexPrewarm("codex", false));
    expect(apiPost).not.toHaveBeenCalled();

    renderHook(() => useCodexPrewarm("codex"));
    expect(apiPost).toHaveBeenCalledWith("/api/codex/prewarm");
  });

  it("stays quiet when the backend cannot warm", async () => {
    apiPost.mockImplementationOnce(() => Promise.reject(new Error("down")));
    expect(() => prewarmCodex()).not.toThrow();
    await Promise.resolve();
  });
});
