import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { WORKBENCH_BUILTIN_APPS } from "./apps";
import { RemoteWorkbenchSurface } from "./remote-surface";

const apiMocks = vi.hoisted(() => ({
  fetchWorkbenchInstalled: vi.fn(),
  backendURL: "http://localhost:8000",
  fetchRuntimePluginStatus: vi.fn(),
  setCloudPluginEnabled: vi.fn(),
  setRuntimePluginEnabled: vi.fn(),
}));

vi.mock("@/core/agents/agent-world-api", () => apiMocks);

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => apiMocks.backendURL,
  getLocalBackendBaseURL: () => "http://localhost:8000",
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
    apiMocks.backendURL = "http://localhost:8000";
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
    window.history.replaceState({}, "", "/");
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

  it("keeps the proxy path and execution scope in a remote embedded application", async () => {
    window.history.replaceState({}, "", "/?echoRemote=host-a");
    apiMocks.backendURL =
      "http://localhost:8000/api/remote-backends/host-a/http";
    renderSurface();
    const iframe = await screen.findByTitle("Narrative Studio");
    const url = new URL(iframe.getAttribute("src")!);
    expect(url.pathname).toBe(
      "/api/remote-backends/host-a/http/api/workbench-packages/narrative_studio/assets/dist/index.html",
    );
    expect(url.searchParams.get("echoRemote")).toBe("host-a");
    expect(url.searchParams.get("echoBackend")).toBe("http://localhost:8000");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/remote-backends/host-a/http/api/workbench-packages/narrative_studio/manifest",
      expect.anything(),
    );
  });

  it("rejects a manifest that redirects the embedded application outside its package", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        ...MANIFEST,
        entry_url: "https://untrusted.invalid/app.html",
      }),
    );
    renderSurface();
    expect(
      await screen.findByText("应用界面包与当前宿主不兼容，请更新或重新安装。"),
    ).toBeVisible();
    expect(screen.queryByTitle("Narrative Studio")).not.toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "叙事工坊暂时不可用" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/尚未安装/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重新检查/ }));
    await waitFor(() =>
      expect(screen.getByTitle("Narrative Studio")).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("starts independent reads together but waits for lifecycle checks before mounting", async () => {
    let finishInstalled!: (value: unknown) => void;
    apiMocks.fetchWorkbenchInstalled.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishInstalled = resolve;
        }),
    );
    renderSurface();
    expect(apiMocks.fetchRuntimePluginStatus).toHaveBeenCalled();
    expect(apiMocks.fetchWorkbenchInstalled).toHaveBeenCalledWith("narrative_studio");
    expect(fetch).toHaveBeenCalled();
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
