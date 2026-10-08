import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginNodeFrame } from "./plugin-node-frame";

vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test" }),
}));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "http://localhost:8310",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ revision: 1 }) });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <PluginNodeFrame
      title="Plugin"
      src="/plugin.html"
      projectId="project-a"
      nodeId="node-b"
      pluginId="plugin-c"
    />,
  );
  const frame = view.getByTitle("Plugin") as HTMLIFrameElement;
  const child = frame.contentWindow!;
  const reply = vi.spyOn(child, "postMessage");
  const send = (overrides: MessageEventInit = {}) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "null",
        source: child,
        data: {
          type: "echo.plugin-state.request",
          requestId: "1",
          action: "get",
          projectId: "forged",
        },
        ...overrides,
      }),
    );
  return { ...view, frame, child, reply, fetchMock, send };
}

describe("isolated plugin state bridge", () => {
  it("keeps scripts isolated and binds state access to the parent-selected namespace", async () => {
    const { frame, send, fetchMock, reply } = setup();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-downloads");
    act(() => {
      send();
    });
    await waitFor(() => expect(reply).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8310/api/design/projects/project-a/plugin-nodes/node-b/state?plugin_id=plugin-c",
      { headers: { Authorization: "Bearer test" } },
    );
    expect(reply).toHaveBeenCalledWith(
      {
        type: "echo.plugin-state.response",
        requestId: "1",
        ok: true,
        payload: { revision: 1 },
      },
      "*",
    );
    expect(JSON.stringify(reply.mock.calls)).not.toContain("Bearer");
  });

  it("rejects other windows and non-opaque origins before fetching", () => {
    const { send, fetchMock } = setup();
    act(() => {
      send({ source: window });
      send({ source: null });
      send({ origin: window.location.origin });
      send({ origin: "https://evil.example" });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies bundled editor operations only to its parent-selected project", async () => {
    const { rerender, send, fetchMock, reply } = setup();
    rerender(
      <PluginNodeFrame
        title="Plugin"
        src="/plugin.html"
        projectId="project-a"
        nodeId="editor"
        pluginId="clip-studio"
      />,
    );
    act(() => {
      send({
        data: {
          type: "echo.clip-studio.request",
          requestId: "edit",
          operation: "edit",
          projectId: "forged",
          body: { operations: [] },
        },
      });
    });
    await waitFor(() => expect(reply).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8310/api/plugins/clip-studio/projects/project-a/edit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test",
        },
        body: JSON.stringify({ operations: [] }),
      },
    );
    fetchMock.mockClear();
    act(() => {
      send({
        data: {
          type: "echo.clip-studio.request",
          requestId: "attack",
          operation: "../../terminal",
        },
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects editor requests from an unrelated plugin", async () => {
    const { send, fetchMock, reply } = setup();
    act(() => {
      send({
        data: {
          type: "echo.clip-studio.request",
          requestId: "edit",
          operation: "edit",
        },
      });
    });
    await waitFor(() => expect(reply).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["navigation", "unmount"])(
    "does not deliver in-flight state after %s",
    async (reason) => {
      const { send, frame, fetchMock, reply, unmount } = setup();
      let finish!: (value: unknown) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      act(() => {
        send();
      });
      if (reason === "navigation") fireEvent.load(frame);
      else unmount();
      await act(async () => {
        finish({ ok: true, json: async () => ({ private: "old state" }) });
      });
      expect(reply).not.toHaveBeenCalled();
    },
  );
});
