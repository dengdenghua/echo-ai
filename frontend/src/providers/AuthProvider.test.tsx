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
  desktopOwnerLogin: vi.fn(),
  logout: vi.fn(),
  packaged: false,
}));
vi.mock("@/core/backend/desktop-shell", () => ({
  isPackagedShell: () => mocks.packaged,
}));

vi.mock("@/core/auth/api", () => ({
  ACCOUNT_FREE_TOKEN: "__account_free__",
  getAuthStatus: mocks.getAuthStatus,
  getMe: mocks.getMe,
  getToken: mocks.getToken,
  getUser: mocks.getStoredUser,
  login: mocks.login,
  logout: mocks.logout,
  refreshToken: vi.fn(),
  register: vi.fn(),
  _writeToken: vi.fn(),
  _clearTokens: mocks.clearTokens,
  desktopOwnerLogin: mocks.desktopOwnerLogin,
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
  mocks.packaged = false;
  sessionStorage.clear();
  mocks.getToken.mockReturnValue(null);
  mocks.getStoredUser.mockReturnValue(null);
  mocks.desktopOwnerLogin.mockResolvedValue(null);
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

it("reads the account's roles right after an interactive sign-in", async () => {
  // Regression: the login response carries no roles, so an admin who had
  // just signed in saw "由管理员安装" on every workbench until a reload.
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
    credential_present: false,
  });
  mocks.login.mockResolvedValue({
    success: true,
    token_type: "bearer",
    expires_in: 3600,
    user: {
      user_id: "local:owner",
      actor_id: "local:owner",
      username: "owner",
    },
  });
  mocks.getMe.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
    roles: ["user", "local", "admin"],
    permissions: [],
    is_active: true,
  });
  let signIn!: ReturnType<typeof useAuth>["login"];
  function Roles() {
    const auth = useAuth();
    signIn = auth.login;
    return <span>{(auth.user?.roles ?? []).join(",") || "no roles"}</span>;
  }

  renderWithProviders(
    <AuthProvider>
      <Roles />
    </AuthProvider>,
  );
  expect(await screen.findByText("no roles")).toBeInTheDocument();
  expect(mocks.getMe).not.toHaveBeenCalled();
  await act(async () => {
    await signIn({ username: "owner" });
  });

  expect(await screen.findByText("user,local,admin")).toBeInTheDocument();
  expect(mocks.getMe).toHaveBeenCalledTimes(1);
});

it("requires an explicit desktop sign-in and then reads the owner's roles", async () => {
  // Regression: the owner is an admin, but the shell's login response has no
  // roles, so 广场 and every workbench card said 请联系管理员.
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
    credential_present: false,
  });
  mocks.desktopOwnerLogin.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "Administrator",
    provider: "local",
  });
  mocks.getMe.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
    roles: ["user", "local", "admin"],
    permissions: [],
    is_active: true,
  });
  let signIn!: ReturnType<typeof useAuth>["desktopLogin"];
  function Roles() {
    const { isLoading, user, desktopLogin } = useAuth();
    signIn = desktopLogin;
    return (
      <div>
        {isLoading ? "loading" : (user?.roles ?? []).join(",") || "signed out"}
      </div>
    );
  }

  renderWithProviders(
    <AuthProvider>
      <Roles />
    </AuthProvider>,
  );

  expect(await screen.findByText("signed out")).toBeInTheDocument();
  expect(mocks.desktopOwnerLogin).not.toHaveBeenCalled();
  await act(async () => signIn());
  expect(await screen.findByText("user,local,admin")).toBeInTheDocument();
  expect(mocks.desktopOwnerLogin).toHaveBeenCalledTimes(1);
});

it("does not create an owner session while signed out, including on quiet retry", async () => {
  mocks.packaged = true;
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    credential_present: false,
  });
  mocks.desktopOwnerLogin.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
  });
  let retry!: ReturnType<typeof useAuth>["retryAuth"];
  function State() {
    retry = useAuth().retryAuth;
    return <AuthState />;
  }
  renderWithProviders(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  expect(await screen.findByText("anonymous")).toBeVisible();
  await act(async () => retry({ quiet: true }));
  expect(mocks.desktopOwnerLogin).not.toHaveBeenCalled();
  expect(mocks.getMe).not.toHaveBeenCalled();
});

it("ends an old silently-created desktop owner cookie before showing sign-in", async () => {
  mocks.packaged = true;
  mocks.getMe.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
  });
  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );
  expect(await screen.findByText("anonymous")).toBeVisible();
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(mocks.desktopOwnerLogin).not.toHaveBeenCalled();
});

it("restores an explicitly chosen desktop owner session on reload in the same window", async () => {
  mocks.packaged = true;
  const owner = {
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
  };
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    credential_present: false,
  });
  mocks.desktopOwnerLogin.mockResolvedValue(owner);
  mocks.getMe.mockResolvedValue(owner);
  let signIn!: ReturnType<typeof useAuth>["desktopLogin"];
  function State() {
    signIn = useAuth().desktopLogin;
    return <AuthState />;
  }
  const first = renderWithProviders(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
  expect(await screen.findByText("anonymous")).toBeVisible();
  await act(async () => signIn());
  expect(await screen.findByText("authenticated")).toBeVisible();
  first.unmount();
  mocks.getAuthStatus.mockResolvedValue({
    enabled: true,
    credential_present: true,
  });
  renderWithProviders(
    <AuthProvider>
      <AuthState />
    </AuthProvider>,
  );
  expect(await screen.findByText("authenticated")).toBeVisible();
  expect(mocks.desktopOwnerLogin).toHaveBeenCalledOnce();
  expect(mocks.logout).not.toHaveBeenCalled();
});

it("names the account by its display name after a reload", async () => {
  // Regression: a reload put the desktop owner's handle ("owner") in the
  // sidebar where the sign-in had shown the OS account name.
  mocks.getToken.mockReturnValue("tab-token");
  mocks.getMe.mockResolvedValue({
    user_id: "local:owner",
    actor_id: "local:owner",
    username: "owner",
    display_name: "Administrator",
    roles: ["user", "local", "admin"],
    permissions: [],
    is_active: true,
  });
  function Name() {
    const { isLoading, user } = useAuth();
    return <div>{isLoading ? "loading" : `name:${user?.username}`}</div>;
  }

  renderWithProviders(
    <AuthProvider>
      <Name />
    </AuthProvider>,
  );

  expect(await screen.findByText("name:Administrator")).toBeInTheDocument();
});
