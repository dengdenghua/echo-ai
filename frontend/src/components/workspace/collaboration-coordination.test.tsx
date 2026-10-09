import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollaborationCoordination } from "./collaboration-coordination";

const initial = {
  actor_id: "user",
  runner_enabled: true,
  resources: [],
  events: [],
  tasks: [
    {
      id: "a",
      title: "修改模型",
      member_id: "builder",
      actor_id: "user",
      status: "done",
      result: "模型验证通过",
      dependencies: [],
      waiting_for: [],
    },
    {
      id: "b",
      title: "更新图纸",
      member_id: "drafter",
      actor_id: "user",
      status: "waiting",
      result: "",
      dependencies: ["a"],
      waiting_for: ["a"],
    },
  ],
  messages: [
    {
      id: "m",
      source_id: "a",
      target_id: "b",
      kind: "handoff",
      body: "请用 R3 出图",
      state: "pending",
      artifacts: [
        { path: "P04.step", version: "R3", verification: "实体检查通过" },
      ],
    },
  ],
};
const members = [
  { id: "builder", name: "建模助手" },
  { id: "drafter", name: "出图助手" },
];
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <CollaborationCoordination threadId="group" members={members} />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("group coordination", () => {
  it.each([{ tasks: [] }, { tasks: [initial.tasks[0]] }])("hides idle/completed work but preserves explicit access to records", async ({ tasks }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initial, tasks, messages: [] })));
    vi.stubGlobal("fetch", fetch);
    mount();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "任务协作" })).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent("echo:open-coordination", { detail: { threadId: "other" } })));
    expect(screen.queryByRole("button", { name: "任务协作" })).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent("echo:open-coordination", { detail: { threadId: "group" } })));
    await screen.findByText("协作记录");
    fireEvent.click(screen.getByRole("button", { name: "任务协作" }));
    expect(screen.queryByRole("button", { name: "任务协作" })).toBeNull();
  });
  it("keeps failed work visible even with no active tasks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initial, tasks: [{ ...initial.tasks[0], status: "failed" }], messages: [] }))));
    mount();
    await screen.findByText("1 项失败待查看");
  });
  it("keeps a read-only member from arranging or acknowledging tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...initial, can_write: false })),
        ),
    );
    mount();
    await screen.findByText(/1 项进行中/);
    fireEvent.click(screen.getByRole("button", { name: /任务协作/ }));
    expect(screen.getByRole("button", { name: "安排任务" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "确认接收" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消任务" })).toBeNull();
  });
  it("keeps detail collapsed and displays versioned handoff and dependency", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(initial)));
    vi.stubGlobal("fetch", fetch);
    mount();
    await screen.findByText(/1 项进行中/);
    expect(screen.queryByText("请用 R3 出图")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /任务协作/ }));
    expect(screen.getByText("请用 R3 出图")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "P04.step" }).parentElement).toHaveTextContent("R3");
    fireEvent.click(screen.getByRole("button", { name: "修改模型" }));
    expect(document.activeElement).toHaveTextContent("建模助手");
    expect(screen.getByText("等待：修改模型")).toBeInTheDocument();
  });
  it("acknowledges only the target task and preserves errors", async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_url, opts) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              opts?.method === "POST" ? { detail: "权限已撤销" } : initial,
            ),
            { status: opts?.method === "POST" ? 403 : 200 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    mount();
    await screen.findByText(/1 项进行中/);
    fireEvent.click(screen.getByRole("button", { name: /任务协作/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认接收" }));
    await screen.findByText("权限已撤销");
    const post = fetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(JSON.parse(post?.[1].body)).toEqual({
      task_id: "b",
      message_id: "m",
      action: "acknowledge",
    });
    expect(screen.getByText("请用 R3 出图")).toBeInTheDocument();
  });
  it("submits a dependency and keeps the request id when retrying", async () => {
    const fetch = vi
      .fn()
      .mockImplementation((_url, opts) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              opts?.method === "POST" ? { detail: "暂时离线" } : initial,
            ),
            { status: opts?.method === "POST" ? 503 : 200 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    mount();
    await screen.findByText(/1 项进行中/);
    fireEvent.click(screen.getByRole("button", { name: /任务协作/ }));
    fireEvent.click(screen.getByRole("button", { name: "安排任务" }));
    fireEvent.change(screen.getByLabelText("任务要求"), {
      target: { value: "检查 R3" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "修改模型" }));
    fireEvent.click(screen.getByRole("button", { name: "开始任务" }));
    await screen.findByText("暂时离线");
    fireEvent.click(screen.getByRole("button", { name: "开始任务" }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter((c) => c[1]?.method === "POST"),
      ).toHaveLength(2),
    );
    const posts = fetch.mock.calls
      .filter((c) => c[1]?.method === "POST")
      .map((c) => JSON.parse(c[1].body));
    expect(posts[0].dependencies).toEqual(["a"]);
    expect(posts[0].request_id).toEqual(posts[1].request_id);
  });
  it("does not expose actions for somebody else's task", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...initial, actor_id: "viewer" })),
        ),
    );
    mount();
    await screen.findByText(/1 项进行中/);
    fireEvent.click(screen.getByRole("button", { name: /任务协作/ }));
    expect(screen.queryByRole("button", { name: "确认接收" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消任务" })).toBeNull();
  });
});


describe("staffing approval", () => {
  const recruitment = [{ id: "gap-1", status: "pending", candidate_id: "optical",
    reason: "现有成员缺少光学设计经验", prompt: "审核镜头设计", roster: ["builder"] }];
  it.each([true, false])("waits for the user's explicit decision: %s", async (accept) => {
    const fetch = vi.fn().mockImplementation((_url, opts) => Promise.resolve(new Response(JSON.stringify(
      opts?.method === "POST" ? { status: accept ? "approved" : "rejected" }
        : { ...initial, can_manage: true, recruitment }
    ))));
    vi.stubGlobal("fetch", fetch);
    mount();
    await screen.findByRole("dialog");
    expect(screen.getByText("现有成员缺少光学设计经验")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: accept ? "同意邀请并安排任务" : "不同意" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, opts]) => opts?.method === "POST")).toHaveLength(1));
    const [url, opts] = fetch.mock.calls.find(([, opts]) => opts?.method === "POST")!;
    expect(url).toContain("/coordination/recruitment/gap-1");
    expect(JSON.parse(opts.body)).toEqual({ accept });
  });
  it("does not offer approval to viewers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      ...initial, can_manage: false, recruitment,
    })))));
    mount();
    await screen.findByText(/1 项进行中/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows completed background deliveries after the leader has stopped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...initial, tasks: [{ ...initial.tasks[0], background: true }], messages: [],
    }))));
    mount();
    await screen.findByText("1 项已交付");
  });
});
