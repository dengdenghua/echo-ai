import { act, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

const mocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  getToken: vi.fn(),
  getStoredUser: vi.fn(),
  clearTokens: vi.fn(),
}));

vi.mock("@/core/auth/api", () => ({
  ACCOUNT_FREE_TOKEN: "__account_free__",
  getAuthStatus: mocks.getAuthStatus,
  getMe: mocks.getMe,
  getToken: mocks.getToken,
  getUser: mocks.getStoredUser,
  login: mocks.login,
  logout: vi.fn(),
  refreshToken: vi.fn(),
  register: vi.fn(),
  _writeToken: vi.fn(),
  _clearTokens: mocks.clearTokens,
}));

vi.mock("@/core/oct/api", () => ({
  octAuthApi: { emailLogin: vi.fn() },
}));

import { AuthProvider, useAuth } from "./AuthProvider";

function AuthState() {
  const { authError, isLoading, isAuthenticated, user } = useAuth();
  return (
    <div>
      {isLoading ? "loading" : isAuthenticated ? "authenticated" : "anonymous"}
      <span>{user?.actor_id}</span>
      <span>{authError ? "auth unavailable" : "auth ready"}</span>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockReturnValue(null);
  mocks.getStoredUser.mockReturnValue(null);
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
  });
  mocks.getMe.mockResolvedValue({
    user_id: "oct:user@example.com",
    actor_id: "oct:user@example.com",
    username: "user@example.com",
    roles: ["user", "oct"],
    permissions: [],
    is_active: true,
  });
  vi.spyOn(window, "fetch").mockResolvedValue(
    new Response(null, { status: 204 }),
  );
});

it("recovers an authenticated actor from the HttpOnly cookie after browser restart", async () => {
  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );

  expect(await screen.findByText("authenticated")).toBeInTheDocument();
  expect(screen.getByText("oct:user@example.com")).toBeInTheDocument();
  expect(mocks.getToken).toHaveBeenCalled();
  expect(mocks.getMe).toHaveBeenCalledTimes(1);
});

it("does not ask for the actor when the browser presented no credential", async () => {
  // Regression: every signed-out first visit (login page, public share link)
  // logged "GET /api/auth/me 401" in the console.
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
    credential_present: false,
  });

  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );

  expect(await screen.findByText("anonymous")).toBeInTheDocument();
  expect(mocks.getMe).not.toHaveBeenCalled();
});

it("still asks when a tab-scoped token exists without a cookie", async () => {
  mocks.getToken.mockReturnValue("tab-token");
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
    credential_present: false,
  });

  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );

  expect(await screen.findByText("authenticated")).toBeInTheDocument();
  expect(mocks.getMe).toHaveBeenCalledTimes(1);
});

it("drops the in-memory actor when a protected request reports expiry", async () => {
  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );
  expect(await screen.findByText("authenticated")).toBeInTheDocument();

  act(() => {
    window.dispatchEvent(new CustomEvent("echo:auth-expired"));
  });

  expect(await screen.findByText("anonymous")).toBeInTheDocument();
  expect(mocks.clearTokens).toHaveBeenCalled();
  expect(window.fetch).toHaveBeenCalledWith("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
});

it("exposes a retryable error when the auth status endpoint is unavailable", async () => {
  mocks.getAuthStatus.mockRejectedValueOnce(new Error("network unavailable"));

  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );

  expect(await screen.findByText("anonymous")).toBeInTheDocument();
  expect(screen.getByText("auth unavailable")).toBeInTheDocument();
  expect(mocks.getMe).not.toHaveBeenCalled();
});

it("drops the previous account's cached data when another account signs in", async () => {
  // Regression: after 退出登录 and signing in as another local account in the
  // same tab, the sidebar still listed the previous account's threads.
  mocks.getMe.mockRejectedValue(new Error("401 Unauthorized"));
  mocks.login.mockResolvedValue({
    success: true,
    token_type: "bearer",
    expires_in: 3600,
    user: {
      user_id: "local:reader",
      actor_id: "local:reader",
      username: "reader",
    },
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(["threads", "search"], [{ thread_id: "previous" }]);
  let signIn!: ReturnType<typeof useAuth>["login"];
  function Capture() {
    signIn = useAuth().login;
    return null;
  }

  renderWithProviders(
    <AuthProvider>
      <Capture />
      <AuthState />
    </AuthProvider>,
    { queryClient },
  );
  expect(await screen.findByText("anonymous")).toBeInTheDocument();
  await act(async () => {
    await signIn({ username: "reader" });
  });

  expect(await screen.findByText("authenticated")).toBeInTheDocument();
  expect(queryClient.getQueryData(["threads", "search"])).toBeUndefined();
});
