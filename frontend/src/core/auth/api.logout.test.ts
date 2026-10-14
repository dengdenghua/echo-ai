import { afterEach, describe, expect, it, vi } from "vitest";

import { _clearTokens, _writeToken, authHeaders, logout } from "./api";

afterEach(() => {
  _clearTokens();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("logout revocation failures", () => {
  it.each([204, 401, 503])("clears local credentials only after success or an invalid session (%s)", async (status) => {
    vi.stubEnv("MODE", "development");
    _writeToken("session-under-test", { actor_id: "alice" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: status === 204, status });
    vi.stubGlobal("fetch", fetchMock);
    if (status === 503) {
      await expect(logout()).rejects.toThrow("退出登录失败");
      expect(authHeaders()).toEqual({ Authorization: "Bearer session-under-test" });
    } else {
      await logout();
      expect(authHeaders()).toEqual({});
    }
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/auth/logout"), {
      method: "POST", headers: { Authorization: "Bearer session-under-test" }, credentials: "include",
    });
  });
});
