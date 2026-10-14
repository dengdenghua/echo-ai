import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectRequiredConnection } from "./required-connections";

vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-only" }),
}));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8310",
}));
const cap = {
  id: "feishu",
  name: "Feishu",
  source: "connector",
  installed: true,
  enabled: true,
  auth_mode: "token",
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());

describe("required role connections", () => {
  it.each([
    [{ installed: false }, "install"],
    [{ permission_review_required: true }, "permissions"],
    [{ permission_active: false }, "permissions"],
    [{ enabled: false }, "disabled"],
    [{ auth_mode: "none" }, "configured"],
  ])(
    "checks installation and grants before asking for authentication: %j",
    async (overrides, state) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(response({ ...cap, ...overrides }));
      vi.stubGlobal("fetch", fetcher);
      expect((await inspectRequiredConnection("feishu")).state).toBe(state);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe(
        "Bearer test-only",
      );
    },
  );

  it.each([
    [true, "configured"],
    [false, "connect"],
    [undefined, "unknown"],
  ])("distinguishes credential state %s", async (connected, state) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(cap))
      .mockResolvedValueOnce(response({ connected }));
    vi.stubGlobal("fetch", fetcher);
    expect((await inspectRequiredConnection("feishu")).state).toBe(state);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "http://localhost:8310/api/capabilities/feishu/status",
    );
  });

  it.each([404, 500])(
    "keeps missing and unavailable distinct (%s)",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, status)));
      expect((await inspectRequiredConnection("feishu")).state).toBe(
        status === 404 ? "missing" : "unknown",
      );
    },
  );

  it("never accepts another connector or a same-name plugin as the dependency", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ ...cap, id: "feishu-helper" }))
      .mockResolvedValueOnce(response({ ...cap, source: "codex_plugin" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await inspectRequiredConnection("feishu")).state).toBe("unknown");
    expect((await inspectRequiredConnection("feishu")).state).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not report an expired or failing status endpoint as configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(cap))
        .mockResolvedValueOnce(response({}, 401)),
    );
    expect((await inspectRequiredConnection("feishu")).state).toBe("unknown");
  });
});
