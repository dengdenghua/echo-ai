import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { EchoAPIError } from "@/core/api/request";
import type { AuthStatus, User } from "@/core/auth/types";
import type * as AuthProviderModule from "@/providers/AuthProvider";

import { WORKBENCH_BUILTIN_APPS } from "./apps";
import { RemoteWorkbenchSurface } from "./remote-surface";

const apiMocks = vi.hoisted(() => ({
  fetchWorkbenchInstalled: vi.fn(),
  fetchRuntimePluginStatus: vi.fn(),
  installCloudPlugin: vi.fn(),
  setCloudPluginEnabled: vi.fn(),
  setRuntimePluginEnabled: vi.fn(),
}));

vi.mock("@/core/agents/agent-world-api", () => apiMocks);

// ``undefined`` is "no auth shell": the surface keeps offering actions and the
// server decides. Tests that need a signed-in account set it explicitly.
const authState = vi.hoisted(() => {
  const state: {
    current: { authStatus: AuthStatus | null; user: User | null } | undefined;
  } = { current: undefined };
  return state;
});

vi.mock("@/providers/AuthProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthProviderModule>()),
  useOptionalAuth: () => authState.current,
}));

const READER = {
  authStatus: {
    enabled: true,
    jwt_available: true,
    allow_registration: false,
    exempt_paths: [],
  },
  user: { user_id: "local:reader", username: "reader", roles: ["user"] },
};

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8000",
}));

vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
}));

const APP = WORKBENCH_BUILTIN_APPS.find(
  (candidate) => candidate.id === "narrative",
)!;

const MANIFEST = {
  schema: "echo.workbench_app.v1",
  id: "narrative_studio",
  name: "Narrative Studio",
  description: "Narrative tools",
  route: "/workspace/narrative",
  module_id: "narrative",
  version: "1.0.0",
  entry: "dist/index.html",
  entry_url: "/api/workbench-packages/narrative_studio/assets/dist/index.html",
  isolation: "iframe",
  permissions: [],
};

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSurface() {
  return render(
    <MemoryRouter initialEntries={["/workspace/narrative?chapter=1"]}>
      <RemoteWorkbenchSurface app={APP} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function manifestResponse() {
  return new Response(JSON.stringify(MANIFEST), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RemoteWorkbenchSurface", () => {
  beforeEach(() => {
    authState.current = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => manifestResponse()),
    );
    apiMocks.fetchRuntimePluginStatus.mockReset().mockResolvedValue({
      installed: true,
      enabled: true,
      lifecycle_state: "enabled",
    });
    apiMocks.setRuntimePluginEnabled.mockReset().mockResolvedValue({
      installed: true,
      enabled: true,
      lifecycle_state: "enabled",
    });
    apiMocks.fetchWorkbenchInstalled.mockReset().mockResolvedValue({
      plugins: ["narrative_studio"],
      skills: [],
      plugin_states: {
        narrative_studio: {
          installed: true,
          enabled: true,
          lifecycle_state: "enabled",
        },
      },
    });
    apiMocks.setCloudPluginEnabled.mockReset().mockResolvedValue({
      installed: true,
      enabled: true,
      lifecycle_state: "enabled",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates the installed manifest and mounts its entry in a restricted iframe", async () => {
    renderSurface();

    const iframe = await screen.findByTitle("Narrative Studio");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/workbench-packages/narrative_studio/manifest",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(iframe).toHaveAttribute(
      "sandbox",
      expect.stringContaining("allow-scripts"),
    );
    expect(iframe).not.toHaveAttribute(
      "sandbox",
      expect.stringContaining("allow-top-navigation"),
    );
    expect(iframe.getAttribute("src")).toContain(
      "http://localhost:8000/api/workbench-packages/narrative_studio/assets/dist/index.html",
    );
    expect(iframe.getAttribute("src")).toContain(
      "echo_host_path=%2Fworkspace%2Fnarrative%3Fchapter%3D1",
    );
  });

  it("preserves the frame during navigation and resets it for a new task", async () => {
    const surface = (hostPath: string) => (
      <MemoryRouter>
        <RemoteWorkbenchSurface app={APP} hostPath={hostPath} />
      </MemoryRouter>
    );
    const view = render(surface("/workspace/narrative?chapter=1"));
    const original = (await screen.findByTitle(
      "Narrative Studio",
    )) as HTMLIFrameElement;
    const originalSrc = original.getAttribute("src");
    const postMessage = vi.spyOn(original.contentWindow!, "postMessage");

    view.rerender(surface("/workspace/narrative?chapter=2"));
    expect(screen.getByTitle("Narrative Studio")).toBe(original);
    expect(original).toHaveAttribute("src", originalSrc);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "echo.host.context",
        route: "/workspace/narrative?chapter=2",
      }),
      "http://localhost:8000",
    );

    const freshPath = "/workspace/narrative?new_task=task-2";
    view.rerender(surface(freshPath));
    const fresh = screen.getByTitle("Narrative Studio");
    expect(fresh).not.toBe(original);
    expect(
      new URL(fresh.getAttribute("src")!).searchParams.get("echo_host_path"),
    ).toBe(freshPath);

    // The app can consume the new-task parameter without loading the frame again.
    view.rerender(surface("/workspace/narrative?chapter=3"));
    expect(screen.getByTitle("Narrative Studio")).toBe(fresh);
    expect(
      new URL(fresh.getAttribute("src")!).searchParams.get("echo_host_path"),
    ).toBe(freshPath);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts navigation only from the mounted frame and trusted backend origin", async () => {
    renderSurface();
    const iframe = (await screen.findByTitle(
      "Narrative Studio",
    )) as HTMLIFrameElement;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://malicious.invalid",
          source: iframe.contentWindow,
          data: {
            type: "echo.workbench.navigate",
            href: "/workspace/design",
          },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:8000",
          source: window,
          data: {
            type: "echo.workbench.navigate",
            href: "/workspace/design",
          },
        }),
      );
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/workspace/narrative?chapter=1",
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://localhost:8000",
          source: iframe.contentWindow,
          data: {
            type: "echo.workbench.navigate",
            href: "/workspace/design?canvas=2",
          },
        }),
      );
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/workspace/design?canvas=2",
    );
  });

  it("shows a repair path for missing packages and can retry without a reload", async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(manifestResponse());

    renderSurface();
    expect(
      await screen.findByRole("heading", { name: "安装叙事工坊" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/安装后即可在这里直接使用/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重新检查/ }));
    await waitFor(() =>
      expect(screen.getByTitle("Narrative Studio")).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("installs a missing app in place and then mounts it", async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(manifestResponse());
    apiMocks.installCloudPlugin.mockResolvedValueOnce({ operation: "install" });

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "安装" }));

    await waitFor(() =>
      expect(screen.getByTitle("Narrative Studio")).toBeInTheDocument(),
    );
    expect(apiMocks.installCloudPlugin).toHaveBeenCalledWith(APP.cloudId);
  });

  it("checks the installed list before asking for the package", async () => {
    // Regression: opening a workbench that is not installed fired the
    // manifest and runtime reads anyway, logging two 404s on the way to the
    // designed install card.
    let finishInstalled!: (value: unknown) => void;
    apiMocks.fetchWorkbenchInstalled.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInstalled = resolve;
        }),
    );
    renderSurface();
    expect(apiMocks.fetchWorkbenchInstalled).toHaveBeenCalledWith(
      "narrative_studio",
    );
    expect(apiMocks.fetchRuntimePluginStatus).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Narrative Studio")).not.toBeInTheDocument();
    await act(async () => {
      finishInstalled({
        plugins: ["narrative_studio"],
        plugin_states: {
          narrative_studio: {
            installed: true,
            enabled: false,
            lifecycle_state: "disabled",
          },
        },
      });
    });
    expect(
      await screen.findByRole("heading", { name: "叙事工坊已停用" }),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Narrative Studio")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not request the package of an app that is not installed", async () => {
    apiMocks.fetchWorkbenchInstalled.mockReset().mockResolvedValue({
      plugins: [],
      plugin_states: {},
    });
    renderSurface();
    expect(
      await screen.findByRole("heading", { name: "安装叙事工坊" }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(apiMocks.fetchRuntimePluginStatus).not.toHaveBeenCalled();
  });

  it("offers one-click enable when the runtime is installed but disabled", async () => {
    apiMocks.fetchRuntimePluginStatus
      .mockReset()
      .mockResolvedValueOnce({
        installed: true,
        enabled: false,
        lifecycle_state: "disabled",
      })
      .mockResolvedValueOnce({
        installed: true,
        enabled: true,
        lifecycle_state: "enabled",
      });

    renderSurface();
    expect(
      await screen.findByRole("heading", { name: "叙事工坊已停用" }),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Narrative Studio")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "启用应用" }));
    await waitFor(() =>
      expect(apiMocks.setCloudPluginEnabled).toHaveBeenCalledWith(
        "workbench_narrative",
        true,
      ),
    );
    expect(await screen.findByTitle("Narrative Studio")).toBeInTheDocument();
  });

  it("explains integrity failures without exposing raw backend JSON", async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "digest mismatch: abc123" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      );

    renderSurface();
    expect(
      await screen.findByText(/安装包损坏或完整性校验失败/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/digest mismatch/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "前往重新安装" }),
    ).toBeInTheDocument();
  });

  it("tells an ordinary account that the admin installs a missing app", async () => {
    authState.current = READER;
    apiMocks.installCloudPlugin.mockReset();
    apiMocks.fetchWorkbenchInstalled.mockReset().mockResolvedValue({
      plugins: [],
      plugin_states: {},
    });

    renderSurface();
    expect(
      await screen.findByRole("heading", { name: "叙事工坊尚未安装" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/工作台由本机管理员安装和管理/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安装" })).toBeNull();
    expect(apiMocks.installCloudPlugin).not.toHaveBeenCalled();
  });

  it("does not offer enable to an ordinary account", async () => {
    authState.current = READER;
    apiMocks.fetchWorkbenchInstalled.mockReset().mockResolvedValue({
      plugins: ["narrative_studio"],
      plugin_states: {
        narrative_studio: {
          installed: true,
          enabled: false,
          lifecycle_state: "disabled",
        },
      },
    });

    renderSurface();
    expect(
      await screen.findByRole("heading", { name: "叙事工坊已停用" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启用应用" })).toBeNull();
    expect(screen.getByText(/需要时请联系管理员/)).toBeInTheDocument();
  });

  it("shows the server's sentence when an install is refused", async () => {
    apiMocks.fetchWorkbenchInstalled.mockReset().mockResolvedValue({
      plugins: [],
      plugin_states: {},
    });
    apiMocks.installCloudPlugin
      .mockReset()
      .mockRejectedValueOnce(
        new EchoAPIError(
          "云插件安装失败: HTTP 403",
          403,
          "只有管理员可以安装或移除工作台，请联系本机管理员。",
        ),
      );

    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "安装" }));
    expect(
      await screen.findByText(
        "安装失败：只有管理员可以安装或移除工作台，请联系本机管理员。",
      ),
    ).toBeInTheDocument();
  });

  it("distinguishes an unreachable local service from a missing app", async () => {
    vi.mocked(fetch)
      .mockReset()
      .mockRejectedValueOnce(new TypeError("offline"));

    renderSurface();
    expect(await screen.findByText(/无法连接本地服务/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新检查" }),
    ).toBeInTheDocument();
  });
});
