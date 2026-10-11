/**
 * 项目页的项目生命周期：取消 / 删除被拒的原因，以及治理（待批准 → 批准 → 运行 → 验收）。
 * 与 page.test.tsx 共用同一套页面渲染方式，拆开只为控制单文件体量。
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
  getToken: () => "test-token",
  currentActorId: () => "test-owner",
  jsonAuthHeaders: () => ({
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
  }),
}));
vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
  getEchoBaseURL: () => "",
  getBackendWebSocketBaseURL: () => "ws://localhost",
}));
vi.mock("@/components/workspace/create-project-dialog", () => ({
  CreateProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="创建项目" /> : null,
}));

import ProjectsPage from "./page";

function jsonResponse(
  value: unknown,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function projectDetail(options?: {
  risks?: Array<{
    type: "milestone" | "task";
    task?: string;
    milestone?: string;
    health: string;
    detail: string;
  }>;
  actions?: Array<{
    action: string;
    label: string;
    api: { method: string; path: string };
  }>;
}) {
  return {
    project: {
      id: "project-1",
      name: "Release hardening",
      goal: "Ship safely",
      status: "running",
      owner: "Eve",
      created_at: "2026-08-20T10:00:00Z",
      started_at: "2026-08-20T11:00:00Z",
      finished_at: "",
    },
    milestones: [],
    tasks: {},
    pm: {
      project_id: "project-1",
      name: "Release hardening",
      status: "running",
      overall_progress: 0,
      done_tasks: 0,
      total_tasks: 0,
      total_estimate: 0,
      remaining_estimate: 0,
      milestones: [],
      burndown: [],
      risks: options?.risks ?? [],
      blockers: [],
      overdue: [],
      next_actions: [],
      assignments: {},
    },
    retro: null,
    available_actions: [],
    action_specs: options?.actions ?? [],
  };
}

// ─── 取消项目 / 删除被拒的原因 ─────────────────────────────────────────

describe("ProjectsPage cancel and delete", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    toastMocks.error.mockReset();
    toastMocks.success.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function route(
    status: string,
    handlers: {
      delete?: () => Response;
      cancel?: () => Response;
    } = {},
  ) {
    const base = projectDetail();
    const detail = { ...base, project: { ...base.project, status } };
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse([
            { id: "project-1", name: "Release hardening", status },
          ]),
        );
      }
      if (url === "/api/projects/portfolio") {
        return Promise.resolve(jsonResponse([]));
      }
      if (url === "/api/projects/project-1" && method === "DELETE") {
        return Promise.resolve(
          handlers.delete?.() ?? jsonResponse({ ok: true }),
        );
      }
      if (url === "/api/projects/project-1/cancel" && method === "POST") {
        return Promise.resolve(
          handlers.cancel?.() ?? jsonResponse({ ok: true, ...detail }),
        );
      }
      return Promise.resolve(jsonResponse(detail));
    });
  }

  it("explains why a blocked project cannot be deleted and offers cancelling", async () => {
    const user = userEvent.setup();
    route("blocked", {
      delete: () =>
        jsonResponse(
          {
            detail: {
              code: "PROJECT_ACTIVE",
              message:
                "project is blocked awaiting recovery and cannot be deleted; cancel it first",
              reason: "project_blocked",
              project_id: "project-1",
              status: "blocked",
              cancel_required: true,
            },
          },
          { status: 409 },
        ),
    });

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });
    await user.click(await screen.findByRole("button", { name: "删除项目" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith(
        "项目处于阻塞状态（仍可恢复），不能直接删除。请先取消项目，再删除。",
        expect.objectContaining({
          action: expect.objectContaining({ label: "取消项目" }),
        }),
      ),
    );
    expect(toastMocks.error).not.toHaveBeenCalledWith("删除项目失败，请重试");
  });

  it("keeps the retry hint for unexpected delete failures", async () => {
    const user = userEvent.setup();
    route("done", {
      delete: () => new Response("boom", { status: 500 }),
    });

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });
    await user.click(await screen.findByRole("button", { name: "删除项目" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "删除" }));

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("删除项目失败，请重试"),
    );
  });

  it("cancels an active project after confirmation", async () => {
    const user = userEvent.setup();
    route("blocked");

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });
    await user.click(await screen.findByRole("button", { name: "取消项目" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "取消项目" }));

    await waitFor(() =>
      expect(toastMocks.success).toHaveBeenCalledWith(
        "项目「Release hardening」已取消",
      ),
    );
    const cancelCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/projects/project-1/cancel",
    );
    expect(cancelCall?.[1]?.method).toBe("POST");
  });

  it("does not offer cancelling a finished project", async () => {
    route("done");

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });

    expect(
      await screen.findByRole("button", { name: "删除项目" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消项目" }),
    ).not.toBeInTheDocument();
  });
});

// ─── 治理：待批准 → 批准 → 运行 → 验收 ─────────────────────────────────

describe("ProjectsPage governance", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    toastMocks.error.mockReset();
    toastMocks.success.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const phase = {
    milestone_id: "MS1",
    name: "调研",
    authorized: false,
    fingerprint: "phase-fp",
    phase_agents: ["eve", "kane"],
    ai_budget_usd: null,
    success_criteria: ["给出结论"],
    budget: { paused: false, reason: null },
  };

  function governance(overrides: Record<string, unknown>) {
    return {
      initiation: {
        state: "approved",
        required: false,
        fingerprint: "init-fp",
        proposed_phase_agents: [],
        staffing_available: true,
      },
      phase,
      acceptance: [],
      plan_fingerprint: "plan-fp",
      blocked_reason: null,
      ...overrides,
    };
  }

  function route(gov: unknown) {
    const detail = {
      ...projectDetail({
        actions: [
          {
            action: "run",
            label: "Run project",
            api: { method: "POST", path: "/api/projects/project-1/run" },
          },
        ],
      }),
      governance: gov,
    };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/projects") {
        return Promise.resolve(
          jsonResponse([
            { id: "project-1", name: "Release hardening", status: "running" },
          ]),
        );
      }
      if (url === "/api/projects/portfolio") {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse({ ok: true, ...detail }));
    });
  }

  function postBody(path: string): unknown {
    const call = fetchMock.mock.calls.find(([input]) => String(input) === path);
    expect(call?.[1]?.method).toBe("POST");
    return JSON.parse(String(call?.[1]?.body));
  }

  it("keeps Run disabled until the owner approves initiation", async () => {
    const user = userEvent.setup();
    route(
      governance({
        initiation: {
          state: "pending",
          required: true,
          fingerprint: "init-fp",
          proposed_phase_agents: [],
          staffing_available: true,
        },
        blocked_reason: "initiation",
      }),
    );

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });

    const run = await screen.findByRole("button", { name: "Run project" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute(
      "title",
      "项目还未获批准立项，批准后才能运行。",
    );
    const panel = screen.getByRole("region", { name: "项目审批" });
    expect(panel).toHaveTextContent("待立项批准");

    await user.type(
      within(panel).getByRole("textbox", { name: "AI 预算上限（美元，可选）" }),
      "8",
    );
    await user.click(within(panel).getByRole("button", { name: "批准立项" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "批准立项" }));

    await waitFor(() =>
      expect(toastMocks.success).toHaveBeenCalledWith("立项已批准"),
    );
    expect(postBody("/api/projects/project-1/initiation/approve")).toEqual({
      expected_fingerprint: "init-fp",
      ai_budget_usd: 8,
    });
  });

  it("authorizes the current phase and then accepts its delivery", async () => {
    const user = userEvent.setup();
    route(governance({ blocked_reason: "phase_authorization" }));

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });
    expect(
      await screen.findByRole("button", { name: "Run project" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "授权本阶段" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "授权本阶段" }),
    );
    await waitFor(() =>
      expect(postBody("/api/projects/project-1/phases/MS1/authorize")).toEqual({
        expected_fingerprint: "phase-fp",
      }),
    );
  });

  it("lets the owner accept a finished phase", async () => {
    const user = userEvent.setup();
    route(
      governance({
        phase: { ...phase, authorized: true },
        acceptance: [
          {
            milestone_id: "MS1",
            name: "调研",
            fingerprint: "delivery-fp",
            success_criteria: ["给出结论"],
            has_content: true,
          },
        ],
        blocked_reason: "owner_acceptance",
      }),
    );

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });
    const panel = await screen.findByRole("region", { name: "项目审批" });
    expect(panel).toHaveTextContent("交付待你验收");
    await user.click(within(panel).getByRole("button", { name: "验收通过" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "验收通过" }));
    await waitFor(() =>
      expect(postBody("/api/projects/project-1/milestones/MS1/accept")).toEqual(
        {
          expected_fingerprint: "delivery-fp",
        },
      ),
    );
  });

  it("enables Run once nothing waits on the owner", async () => {
    route(governance({ phase: { ...phase, authorized: true } }));

    renderWithProviders(<ProjectsPage />, { locale: "zh-CN" });

    expect(
      await screen.findByRole("button", { name: "Run project" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("region", { name: "项目审批" }),
    ).not.toBeInTheDocument();
  });
});
