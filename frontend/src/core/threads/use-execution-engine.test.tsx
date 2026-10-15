import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCoderModelProfile } from "@/core/coder/api";
import type * as CoderApi from "@/core/coder/api";
import type { Model } from "@/core/models/types";
import { previewExecutionEngine } from "@/core/realtime/execution-policy";

import { useExecutionEngine } from "./use-execution-engine";

const zen: Model = {
  id: "big-pickle",
  name: "big-pickle",
  display_name: "Big Pickle",
  entry_id: "opencode-zen",
};
const custom: Model = {
  id: "deepseek-chat",
  name: "deepseek-chat",
  display_name: "DeepSeek",
  entry_id: "deepseek",
};

/** Answer each readiness endpoint: OpenCode status and the model catalog. */
function serve(status: object, models: Model[] = []) {
  vi.mocked(fetch).mockImplementation(
    async (input) =>
      ({
        ok: true,
        json: async () =>
          String(input).includes("/api/llm-models") ? { models } : status,
      }) as Response,
  );
}

type EngineProps = Parameters<typeof useExecutionEngine>[0];

function renderEngine(props: Partial<EngineProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    (overrides: Partial<EngineProps>) =>
      useExecutionEngine({
        threadId: "new",
        principal: "alice",
        codingTask: false,
        orchestrated: false,
        enabled: true,
        ...props,
        ...overrides,
      }),
    { wrapper, initialProps: {} },
  );
}

async function settled(result: {
  current: ReturnType<typeof useExecutionEngine>;
}) {
  await waitFor(() => expect(result.current.engineReady).not.toBeNull());
}

vi.mock("@/core/coder/api", async (original) => ({
  ...(await original<typeof CoderApi>()),
  getCoderModelProfile: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false, reason: "not configured" }),
    }),
  );
  vi.mocked(getCoderModelProfile).mockResolvedValue({
    execution_available: true,
  } as never);
});

afterEach(() => vi.unstubAllGlobals());

describe("per-task engine preference", () => {
  it("inherits a fork's engine once within the same principal, then keeps its own choice", () => {
    localStorage.setItem("echo:execution-engine:alice:parent", "codex");
    localStorage.setItem("echo:execution-engine:bob:parent", "opencode");
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      () =>
        useExecutionEngine({
          threadId: "child",
          parentThreadId: "parent",
          principal: "alice",
          codingTask: false,
          orchestrated: false,
          enabled: false,
        }),
      { wrapper },
    );
    expect(result.current.preference).toBe("codex");
    expect(localStorage.getItem("echo:execution-engine:alice:child")).toBe(
      "codex",
    );
    act(() => result.current.setPreference("opencode"));
    rerender();
    expect(result.current.preference).toBe("opencode");
    expect(localStorage.getItem("echo:execution-engine:alice:parent")).toBe(
      "codex",
    );
  });
  it.each(["opencode", "codex"] as const)(
    "keeps a ready %s engine available when a second member joins",
    async (preference) => {
      localStorage.setItem("echo:execution-engine:alice:team", preference);
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ available: true, reason: null }),
      } as Response);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result, rerender } = renderHook(
        ({ orchestrated, nativeTopology }) =>
          useExecutionEngine({
            threadId: "team",
            principal: "alice",
            codingTask: false,
            orchestrated,
            nativeTopology,
            enabled: true,
          }),
        {
          wrapper,
          initialProps: { orchestrated: false, nativeTopology: false },
        },
      );
      await waitFor(() => {
        expect(result.current.opencodeAvailable).toBe(true);
        expect(result.current.codexAvailable).toBe(true);
      });
      rerender({ orchestrated: true, nativeTopology: false });
      expect(result.current.preference).toBe(preference);
      expect(result.current.engine).toBe(preference);
      expect(result.current.opencodeAvailable).toBe(true);
      expect(result.current.codexAvailable).toBe(true);
      expect(result.current.codexUnavailableReason).toBeNull();
      expect(result.current.opencodeUnavailableReason ?? "").not.toContain(
        "团队",
      );
      // Topology planning now uses the selected external engine too.
      rerender({ orchestrated: true, nativeTopology: true });
      expect(result.current.opencodeAvailable).toBe(true);
      expect(result.current.codexAvailable).toBe(true);
      expect(result.current.codexUnavailableReason).toBeNull();
      expect(result.current.preference).toBe(preference);
      rerender({ orchestrated: true, nativeTopology: false });
      expect(result.current.opencodeAvailable).toBe(true);
      expect(result.current.codexAvailable).toBe(true);
    },
  );

  it.each(["pending", "failed"])(
    "keeps OpenCode selected while readiness is %s",
    async (status) => {
      if (status === "pending")
        vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
      if (status === "failed")
        vi.mocked(fetch).mockRejectedValue(new Error("offline"));
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () =>
          useExecutionEngine({
            threadId: "new",
            principal: "alice",
            codingTask: true,
            orchestrated: false,
            enabled: true,
          }),
        { wrapper },
      );
      expect(result.current.preference).toBe("opencode");
      expect(result.current.engine).toBe("opencode");
      if (status !== "pending") {
        await waitFor(() =>
          expect(
            client.getQueryState(["opencode-status", "alice"])?.status,
          ).toBe("error"),
        );
      }
      expect(result.current.engine).toBe("opencode");
      // Still checking hides the first-run line; a failed check does not.
      if (status === "pending") expect(result.current.engineReady).toBeNull();
      else await waitFor(() => expect(result.current.engineReady).toBe(false));
      expect(result.current.engine).toBe("opencode");
      expect(result.current.opencodeAvailable).toBe(false);
      act(() => result.current.setPreference("auto"));
      act(() =>
        client.setQueryData(["opencode-status", "alice"], {
          available: true,
          reason: null,
        }),
      );
      expect(result.current.preference).toBe("auto");
    },
  );

  it("runs Auto on Echo's own models while OpenCode is not installed", async () => {
    serve(
      {
        available: false,
        reason: "OpenCode 还没安装",
        reason_code: "not_installed",
      },
      [custom],
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useExecutionEngine({
          threadId: "first",
          principal: "alice",
          codingTask: false,
          orchestrated: false,
          enabled: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.preference).toBe("auto"));
    expect(result.current.engine).toBe("echo");
    // Echo's own model answers before a signed-in Codex, as Auto does.
    await settled(result);
    expect(result.current.engine).toBe("echo");
    expect(result.current.engineReady).toBe(true);
    // A choice the person made stays theirs.
    act(() => result.current.setPreference("opencode"));
    expect(result.current.engine).toBe("opencode");
  });

  it("uses team orchestration before an unset task is sent and pins the sent choice", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ orchestrated, enabled }) =>
        useExecutionEngine({
          threadId: "new",
          principal: "alice",
          codingTask: false,
          orchestrated,
          enabled,
        }),
      { wrapper, initialProps: { orchestrated: false, enabled: false } },
    );
    expect(result.current.preference).toBe("auto");
    rerender({ orchestrated: false, enabled: true });
    expect(result.current.preference).toBe("opencode");
    rerender({ orchestrated: true, enabled: true });
    expect(result.current.preference).toBe("auto");
    expect(result.current.engine).toBe("opencode");
    act(() => result.current.rememberForThread("assigned"));
    rerender({ orchestrated: false, enabled: true });
    expect(result.current.preference).toBe("auto");
  });

  it.each([
    [null, false, undefined, "opencode"],
    ["auto", false, undefined, "auto"],
    ["echo", false, undefined, "echo"],
    ["codex", false, undefined, "codex"],
    [null, true, undefined, "auto"],
    [null, false, "codex_app_server", "auto"],
  ] as const)(
    "defaults an unset independent task to OpenCode (%s, team=%s, role=%s)",
    async (saved, orchestrated, roleBackend, expected) => {
      const key = "echo:execution-engine:alice:new";
      if (saved !== null) localStorage.setItem(key, saved);
      serve({ available: true, reason: null }, [zen]);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () =>
          useExecutionEngine({
            threadId: "new",
            principal: "alice",
            codingTask: false,
            orchestrated,
            roleBackend,
            enabled: true,
          }),
        { wrapper },
      );
      await waitFor(() =>
        expect(client.getQueryState(["opencode-status", "alice"])?.status).toBe(
          "success",
        ),
      );
      await waitFor(() => expect(result.current.preference).toBe(expected));
      if (expected === "opencode") {
        expect(result.current.engine).toBe("opencode");
        expect(localStorage.getItem(key)).toBeNull();
        act(() => result.current.rememberForThread("assigned"));
        expect(
          localStorage.getItem("echo:execution-engine:alice:assigned"),
        ).toBe("opencode");
        act(() =>
          client.setQueryData(["opencode-status", "alice"], {
            available: false,
            reason: "offline",
          }),
        );
        await waitFor(() =>
          expect(result.current.opencodeAvailable).toBe(false),
        );
        expect(result.current.engine).toBe("opencode");
      } else {
        expect(localStorage.getItem(key)).toBe(saved);
      }
    },
  );

  it.each([
    ["auto", undefined, false, false, true, "opencode"],
    ["auto", undefined, true, false, true, "opencode"],
    ["auto", undefined, true, false, false, "opencode"],
    ["auto", "codex_app_server", false, true, true, "opencode"],
    ["echo", "codex_app_server", true, false, true, "echo"],
    ["codex", undefined, false, false, false, "codex"],
    ["opencode", "codex_app_server", true, false, false, "opencode"],
  ] as const)(
    "previews %s independently of the role %s",
    (
      preference,
      roleBackend,
      codingTask,
      orchestrated,
      codexAvailable,
      expected,
    ) => {
      expect(
        previewExecutionEngine({
          preference,
          roleBackend,
          codingTask,
          orchestrated,
          codexAvailable,
        }),
      ).toBe(expected);
    },
  );

  it("scopes saved choices to the principal and task and follows a new task's assigned id", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ principal, threadId }) =>
        useExecutionEngine({
          principal,
          threadId,
          codingTask: true,
          orchestrated: false,
          enabled: true,
        }),
      { initialProps: { principal: "alice", threadId: "new" }, wrapper },
    );
    expect(result.current.engine).toBe("opencode");
    act(() => result.current.setPreference("echo"));
    expect(result.current.engine).toBe("echo");
    act(() => result.current.rememberForThread("assigned-id"));
    rerender({ principal: "alice", threadId: "assigned-id" });
    expect(result.current.preference).toBe("echo");
    rerender({ principal: "bob", threadId: "assigned-id" });
    expect(result.current.preference).toBe("opencode");
    rerender({ principal: "alice", threadId: "assigned-id" });
    expect(result.current.preference).toBe("echo");
  });
});

describe("a new conversation starts on an engine that can answer", () => {
  it.each([
    ["installed without a model", { available: true, reason: null }],
    [
      "not installed",
      { available: false, reason: "未安装", reason_code: "not_installed" },
    ],
    ["unavailable", { available: false, reason: "暂时无法读取 Zen 连接配置" }],
  ])(
    "uses a signed-in Codex when OpenCode is %s and Echo has no model",
    async (_label, status) => {
      serve(status);
      const { result } = renderEngine();
      await settled(result);
      expect(result.current.preference).toBe("codex");
      expect(result.current.engine).toBe("codex");
      expect(result.current.engineReady).toBe(true);
      // A default is not a pick: nothing is stored until the task is sent.
      expect(
        localStorage.getItem("echo:execution-engine:alice:new"),
      ).toBeNull();
      expect(
        localStorage.getItem("echo:execution-engine-last:alice"),
      ).toBeNull();
    },
  );

  it("keeps the usual start and the setup line when nothing can answer", async () => {
    serve({ available: true, reason: null });
    vi.mocked(getCoderModelProfile).mockResolvedValue({
      execution_available: false,
      execution_unavailable_reason: "account_required",
    } as never);
    const { result } = renderEngine();
    await settled(result);
    expect(result.current.preference).toBe("opencode");
    expect(result.current.engineReady).toBe(false);
  });

  it("keeps OpenCode when it can serve the conversation's picked model", async () => {
    serve({ available: true, reason: null }, [custom]);
    const { result, rerender } = renderEngine({ modelName: "deepseek-chat" });
    await settled(result);
    expect(result.current.preference).toBe("opencode");
    expect(result.current.engineReady).toBe(true);
    // Auto needs a Zen connection; Echo's own engine runs the custom model.
    rerender({ modelName: "auto" });
    expect(result.current.preference).toBe("auto");
    expect(result.current.engine).toBe("echo");
  });

  it("offers the last explicit pick to a new task while it can answer", async () => {
    serve({ available: true, reason: null }, [zen]);
    const { result, rerender } = renderEngine();
    await settled(result);
    expect(result.current.preference).toBe("opencode");
    act(() => result.current.setPreference("codex"));
    rerender({ threadId: "another-task" });
    expect(result.current.preference).toBe("codex");
    // Another person's choices are theirs alone.
    rerender({ principal: "bob", threadId: "fresh" });
    expect(result.current.preference).toBe("opencode");
    // Signed out of Codex: the pick waits, an engine that answers starts.
    vi.mocked(getCoderModelProfile).mockResolvedValue({
      execution_available: false,
    } as never);
    const later = renderEngine({ threadId: "third" });
    await settled(later.result);
    expect(later.result.current.preference).toBe("opencode");
  });

  it("never replaces a pick saved for the conversation", async () => {
    localStorage.setItem("echo:execution-engine:alice:new", "opencode");
    serve({ available: true, reason: null });
    const { result } = renderEngine();
    await settled(result);
    expect(result.current.preference).toBe("opencode");
    expect(result.current.engine).toBe("opencode");
    expect(result.current.engineReady).toBe(false);
  });

  it.each([
    [false, true, true, "codex"],
    [true, true, true, "echo"],
    [false, false, true, "echo"],
    [false, true, false, "opencode"],
  ] as const)(
    "previews Auto (Echo model %s, Codex %s, OpenCode lacks a model %s) as %s",
    (echoReady, codexAvailable, opencodeNoModel, expected) => {
      expect(
        previewExecutionEngine({
          preference: "auto",
          codingTask: false,
          orchestrated: false,
          codexAvailable,
          opencodeNoModel,
          echoReady,
        }),
      ).toBe(expected);
    },
  );
});
