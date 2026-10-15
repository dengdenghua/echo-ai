import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREWARM_RENEW_MS,
  prewarmOpencode,
  resetOpencodePrewarm,
  useOpencodePrewarm,
} from "./opencode-prewarm";

const apiPost = vi.hoisted(() => vi.fn(() => Promise.resolve({ warm: true })));

vi.mock("@/core/api/request", () => ({ apiPost }));

describe("OpenCode prewarm", () => {
  afterEach(() => {
    apiPost.mockClear();
    resetOpencodePrewarm();
  });

  it("asks once per model inside the renew window", () => {
    prewarmOpencode("opencode-zen/m", 0);
    prewarmOpencode("opencode-zen/m", PREWARM_RENEW_MS - 1);
    prewarmOpencode("opencode-zen/other", 0);
    prewarmOpencode("opencode-zen/m", PREWARM_RENEW_MS);
    expect(apiPost.mock.calls).toEqual([
      ["/api/opencode/prewarm", { query: { model: "opencode-zen/m" } }],
      ["/api/opencode/prewarm", { query: { model: "opencode-zen/other" } }],
      ["/api/opencode/prewarm", { query: { model: "opencode-zen/m" } }],
    ]);
  });

  it("warms only conversations that run on OpenCode and can reply", () => {
    renderHook(() => useOpencodePrewarm("codex", "m"));
    renderHook(() => useOpencodePrewarm("opencode", "m", false));
    expect(apiPost).not.toHaveBeenCalled();

    renderHook(() => useOpencodePrewarm("opencode", undefined));
    expect(apiPost).toHaveBeenCalledWith("/api/opencode/prewarm", {
      query: {},
    });
  });

  it("stays quiet when the backend cannot warm", async () => {
    apiPost.mockImplementationOnce(() => Promise.reject(new Error("down")));
    expect(() => prewarmOpencode("m")).not.toThrow();
    await Promise.resolve();
  });
});
