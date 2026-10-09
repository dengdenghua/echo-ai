import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { STUB_RESPONSE_EVENT } from "./client";
import {
  EchoAPIError,
  apiDelete,
  apiFetch,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  failureDetail,
  isApiErrorStatus,
  untypedApi,
} from "./request";

const fetchMock = vi.fn();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("typed request layer", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  test("GET fills and encodes path params and keeps the method implicit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ thread_id: "t/1" }));

    const data = await apiGet("/api/cowork/{thread_id}", {
      path: { thread_id: "t/1" },
    });

    expect(data).toEqual({ thread_id: "t/1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/cowork/t%2F1", {
      headers: {},
    });
  });

  test("serializes query params, skipping nullish values", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));

    await apiGet("/api/cowork/{thread_id}/search", {
      path: { thread_id: "t1" },
      query: { q: "hello world", kinds: "message", limit: 5, until_seq: null },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/cowork/t1/search?q=hello+world&kinds=message&limit=5",
    );
  });

  test("POST sends a JSON body with a JSON content type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiPost("/api/cowork/{thread_id}/mode", {
      path: { thread_id: "t1" },
      body: { mode: "swarm" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/cowork/t1/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "swarm" }),
    });
  });

  test("POST without a body sends no body and no content type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiPost("/api/collab/{thread_id}/deliveries/{delivery_id}/retry", {
      path: { thread_id: "t1", delivery_id: "d1" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collab/t1/deliveries/d1/retry",
      { method: "POST", headers: {} },
    );
  });

  test("PUT / PATCH / DELETE use their verbs", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiPut("/api/cowork/{thread_id}/roster", {
      path: { thread_id: "t1" },
      body: { mode: "chat", agent_ids: [] },
      keepalive: true,
    });
    await apiPatch("/api/collab/{thread_id}/annotations/{annotation_id}", {
      path: { thread_id: "t1", annotation_id: "a1" },
      body: { resolved: true },
    });
    await apiDelete("/api/collab/{thread_id}/annotations/{annotation_id}", {
      path: { thread_id: "t1", annotation_id: "a1" },
    });

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init.method]),
    ).toEqual([
      ["/api/cowork/t1/roster", "PUT"],
      ["/api/collab/t1/annotations/a1", "PATCH"],
      ["/api/collab/t1/annotations/a1", "DELETE"],
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
  });

  test("forwards signal and extra headers, and attaches the CSRF token", async () => {
    document.cookie = "csrf_token=abc%20123";
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await apiGet("/api/cowork/{thread_id}/trust", {
      path: { thread_id: "t1" },
      signal: controller.signal,
      headers: { "X-Trace": "1" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/cowork/t1/trust", {
      headers: { "X-CSRF-Token": "abc 123", "X-Trace": "1" },
      signal: controller.signal,
    });
  });

  test("honours a baseUrl override", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await apiGet("/api/teams", { baseUrl: "http://127.0.0.1:4105" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4105/api/teams",
    );
  });

  test("throws EchoAPIError with status and parsed detail on non-2xx", async () => {
    const detail = { code: "THREAD_PROJECT_BOUND" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail }, 409));

    const error = await apiGet("/api/cowork/{thread_id}", {
      path: { thread_id: "t1" },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EchoAPIError);
    expect(error).toMatchObject({ status: 409, detail });
    expect((error as Error).message).toContain(
      "GET /api/cowork/t1 failed: 409",
    );
    expect(isApiErrorStatus(error, 404, 409)).toBe(true);
    expect(isApiErrorStatus(error, 404)).toBe(false);
  });

  test("errorMessage keeps a module's legacy wording", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("boom", { status: 500, statusText: "Server Error" }),
    );

    const error = await apiGet("/api/teams", {
      errorMessage: (f) => `Failed to list teams: ${f.status} ${f.text}`,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EchoAPIError);
    expect((error as Error).message).toBe("Failed to list teams: 500 boom");
    expect((error as EchoAPIError).detail).toBe("boom");
  });

  test("failureDetail only reads detail from a JSON object body", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "nope" }, 400))
      .mockResolvedValueOnce(jsonResponse("plain", 400));
    const seen: unknown[] = [];
    const capture = (f: Parameters<typeof failureDetail>[0]) => {
      seen.push(failureDetail(f));
      return "x";
    };

    await apiGet("/api/teams", { errorMessage: capture }).catch(() => null);
    await apiGet("/api/teams", { errorMessage: capture }).catch(() => null);

    expect(seen).toEqual(["nope", undefined]);
  });

  test("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      apiDelete("/api/collab/{thread_id}/annotations/{annotation_id}", {
        path: { thread_id: "t1", annotation_id: "a1" },
      }),
    ).resolves.toBeUndefined();
  });

  test("reports stub payloads once through the shared EchoClient hook", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events: unknown[] = [];
    const listener = (event: Event) =>
      events.push((event as CustomEvent).detail);
    window.addEventListener(STUB_RESPONSE_EVENT, listener);
    fetchMock.mockImplementation(async () => jsonResponse({ _stub: true }));

    await apiGet("/api/teams/{team_id}/invites", { path: { team_id: "stub" } });
    await apiGet("/api/teams/{team_id}/invites", { path: { team_id: "stub" } });

    window.removeEventListener(STUB_RESPONSE_EVENT, listener);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { method: "GET", path: "/api/teams/stub/invites" },
    ]);
  });

  test("apiFetch returns the checked raw Response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("raw text", { status: 200 }));

    const response = await apiFetch("get", "/api/cowork/{thread_id}", {
      path: { thread_id: "t1" },
    });

    await expect(response.text()).resolves.toBe("raw text");
  });

  test("raw bodies (FormData) skip JSON encoding and the JSON content type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.txt");

    await untypedApi.post("/api/uploads/raw", {
      reason: "test-only route",
      body: form,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    expect(init.headers).toEqual({});
  });

  test("untypedApi uses the path verbatim and still checks status", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ value: 1 }))
      .mockResolvedValueOnce(jsonResponse({ detail: "missing" }, 404));

    const value = await untypedApi.get<{ value: number }>("/api/x/{literal}", {
      reason: "not in the OpenAPI snapshot",
      query: { a: ["1", "2"], b: undefined },
    });
    expect(value).toEqual({ value: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/x/{literal}?a=1&a=2");

    const error = await untypedApi
      .delete("/api/x/1", { reason: "not in the OpenAPI snapshot" })
      .catch((e: unknown) => e);
    expect(isApiErrorStatus(error, 404)).toBe(true);
    expect((error as EchoAPIError).detail).toBe("missing");
  });

  test("network failures propagate untouched", async () => {
    const boom = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(boom);

    await expect(apiGet("/api/teams")).rejects.toBe(boom);
  });
});
