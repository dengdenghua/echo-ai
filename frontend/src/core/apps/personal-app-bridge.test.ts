import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { untypedApi } from "@/core/api/request";
import {
  appTaskRequest,
  attachPersonalAppBridge,
  personalAppDocument,
} from "./personal-app-bridge";

vi.mock("@/core/api/request", () => ({
  untypedApi: { get: vi.fn(), put: vi.fn() },
}));

let frame: HTMLIFrameElement;
let detach: (() => void) | undefined;
let response: ReturnType<typeof vi.spyOn>;
const requestTask = vi.fn();
const getTask = vi.fn();
const packet = (
  method = "storage.get",
  params: unknown = { key: "state" },
  id = "one",
) => ({ type: "echo.app.request", channel: "session", id, method, params });

function send(
  data: unknown,
  source: MessageEventSource | null = frame.contentWindow,
  origin = "null",
) {
  window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
}
function attach(permissions = ["app.storage", "task.request"]) {
  detach = attachPersonalAppBridge({
    frame,
    channel: "session",
    deploymentId: "release-1",
    permissions,
    requestTask,
    getTask,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  frame = document.createElement("iframe");
  document.body.append(frame);
  response = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
});
afterEach(() => {
  detach?.();
  detach = undefined;
  frame.remove();
});

describe("opaque application bridge", () => {
  it("ignores messages from other windows, origins and viewer sessions", () => {
    attach();
    send(packet(), window);
    send(packet(), frame.contentWindow, "https://untrusted.test");
    send({ ...packet(), channel: "old-viewer" });
    expect(untypedApi.get).not.toHaveBeenCalled();
    expect(response).not.toHaveBeenCalled();
  });

  it("mediates app-scoped reads and revisioned writes without giving the frame credentials", async () => {
    attach();
    vi.mocked(untypedApi.get).mockResolvedValue({ value: null, revision: 0 });
    vi.mocked(untypedApi.put).mockResolvedValue({
      value: { n: 1 },
      revision: 1,
    });
    send(packet());
    await waitFor(() =>
      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({ result: { value: null, revision: 0 } }),
        "*",
      ),
    );
    send(
      packet(
        "storage.set",
        {
          key: "state",
          value: { n: 1 },
          revision: 0,
          deploymentId: "other-app",
          token: "untrusted",
        },
        "two",
      ),
    );
    await waitFor(() =>
      expect(untypedApi.put).toHaveBeenCalledWith(
        "/api/personal-apps/release-1/data/state",
        expect.objectContaining({
          headers: { "X-Echo-App-Bridge": "1" },
          body: { value: { n: 1 }, expected_revision: 0, delete: false },
        }),
      ),
    );
    expect(JSON.stringify(response.mock.calls)).not.toContain("untrusted");
  });

  it("rejects undeclared capabilities and arbitrary backend methods", async () => {
    attach([]);
    send(packet());
    send(packet("task.request", { kind: "ai", prompt: "Summarize" }, "two"));
    send(packet("backend.fetch", { path: "/api/admin" }, "three"));
    await waitFor(() => expect(response).toHaveBeenCalledTimes(3));
    expect(untypedApi.get).not.toHaveBeenCalled();
    expect(requestTask).not.toHaveBeenCalled();
    expect(response.mock.calls.every(([data]) => "error" in data)).toBe(true);
  });

  it("does not replay mutations or write without a revision", async () => {
    attach();
    vi.mocked(untypedApi.put).mockResolvedValue({ revision: 1 });
    const write = packet("storage.set", {
      key: "state",
      value: 7,
      revision: 0,
    });
    send(write);
    send(write);
    send(packet("storage.set", { key: "state", value: 8 }, "two"));
    await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
    expect(untypedApi.put).toHaveBeenCalledTimes(1);
  });

  it("preserves conflict codes so apps can recover without overwriting data", async () => {
    attach();
    vi.mocked(untypedApi.put).mockRejectedValue(
      Object.assign(new Error("Read again"), { status: 409 }),
    );
    send(packet("storage.delete", { key: "state", revision: 2 }));
    await waitFor(() =>
      expect(response).toHaveBeenCalledWith(
        expect.objectContaining({
          error: { message: "Read again", code: 409 },
        }),
        "*",
      ),
    );
  });

  it("suppresses late responses after closing and aborts in-flight requests", async () => {
    attach();
    let finish: (value: unknown) => void = () => {};
    vi.mocked(untypedApi.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    send(packet());
    const signal = vi.mocked(untypedApi.get).mock.calls[0]![1].signal;
    detach!();
    expect(signal?.aborted).toBe(true);
    finish({ value: "private", revision: 1 });
    await Promise.resolve();
    expect(response).not.toHaveBeenCalled();
  });

  it("submits validated tasks to host review without accepting permission overrides", async () => {
    attach();
    const task = {
      kind: "plugin" as const,
      target: "mail",
      prompt: "Draft a follow-up",
    };
    const route = "/workspace/realtime/task-1";
    requestTask.mockResolvedValue({
      status: "connecting",
      taskId: "task-1",
      route,
    });
    send(
      packet("task.request", {
        ...task,
        approvalPolicy: "never",
        token: "bad",
      }),
    );
    await waitFor(() => expect(requestTask).toHaveBeenCalledWith(task));
    expect(untypedApi.put).not.toHaveBeenCalled();
    expect(() =>
      appTaskRequest({ kind: "plugin", target: "../admin", prompt: "Run" }),
    ).toThrow();
  });

  it("reads only viewer-owned task results and requires the task permission", async () => {
    attach();
    getTask.mockImplementation((id) => {
      if (id !== "own-task")
        throw new Error("Task does not belong to this application session");
      return {
        taskId: id,
        status: "completed",
        terminal: true,
        text: "Answer",
      };
    });
    send(packet("task.get", { taskId: "own-task" }));
    send(packet("task.get", { taskId: "other-user-thread" }, "two"));
    await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
    expect(response.mock.calls[0]![0].result.text).toBe("Answer");
    expect(response.mock.calls[1]![0].error).toBeDefined();
    expect(untypedApi.get).not.toHaveBeenCalled();
    detach!();
    attach([]);
    send(packet("task.get", { taskId: "own-task" }, "three"));
    await waitFor(() => expect(response).toHaveBeenCalledTimes(3));
    expect(getTask).toHaveBeenCalledTimes(2);
  });

  it("injects a credential-free SDK and prevents channel script breakout", () => {
    const doc = personalAppDocument(
      "<h1>App</h1>",
      "</script><script>bad()</script>",
    );
    expect(doc).toContain("window,'echo'");
    expect(doc).toContain("echo.app.ready");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).not.toContain("<script>bad()");
    expect(doc).not.toContain("Bearer");
  });

  it("allows long-lived result polling without exhausting the mutation replay ledger", async () => {
    let time = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    try {
      attach();
      getTask.mockReturnValue({ status: "running", terminal: false, text: "" });
      for (let index = 0; index < 1005; index++) {
        time += 3000;
        send(packet("task.get", { taskId: "own-task" }, `poll-${index}`));
        await Promise.resolve();
      }
      expect(getTask).toHaveBeenCalledTimes(1005);
      expect(response.mock.calls.some(([data]) => data.error)).toBe(false);
      vi.mocked(untypedApi.put).mockResolvedValue({ revision: 1 });
      send(
        packet("storage.set", { key: "state", value: 1, revision: 0 }, "write"),
      );
      await Promise.resolve();
      expect(untypedApi.put).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
});
