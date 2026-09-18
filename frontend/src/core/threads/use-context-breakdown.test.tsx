import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useContextBreakdown } from "./use-context-breakdown";

function stubResponse(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("useContextBreakdown", () => {
  it("reads the measured request for the thread", async () => {
    const fetchMock = stubResponse({
      segments: [
        { key: "messages", tokens: 800 },
        { key: "mcp_tools", tokens: 120 },
      ],
      total_tokens: 920,
      source: "request",
    });

    const { result } = renderHook(() => useContextBreakdown("trn_abc"));

    await waitFor(() => expect(result.current.breakdown).not.toBeNull());
    expect(result.current.breakdown?.source).toBe("request");
    expect(result.current.breakdown?.segments).toEqual([
      { key: "messages", tokens: 800 },
      { key: "mcpTools", tokens: 120 },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/threads/trn_abc/context-breakdown",
    );
  });

  it("marks an estimated answer as an estimate", async () => {
    stubResponse({
      segments: [{ key: "messages", tokens: 400 }],
      source: "estimate",
      measured_at: null,
    });

    const { result } = renderHook(() => useContextBreakdown("trn_abc"));

    await waitFor(() => expect(result.current.breakdown).not.toBeNull());
    expect(result.current.breakdown?.source).toBe("estimate");
  });

  it("stays null when the server answers with nothing usable", async () => {
    // The ring falls back to its own split rather than showing an empty list.
    stubResponse({ segments: [{ key: "future_bucket", tokens: 5 }] });

    const { result } = renderHook(() => useContextBreakdown("trn_abc"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.breakdown).toBeNull();
  });

  it("does not ask about a thread that does not exist yet", () => {
    const fetchMock = stubResponse({ segments: [] });

    renderHook(() => useContextBreakdown("new"));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { result } = renderHook(() => useContextBreakdown("trn_abc"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.breakdown).toBeNull();
  });
});
