import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceTaskPanel, DeviceTaskSection } from "./device-task-panel";
import { taskWorkspaceRequest, type DeviceTask } from "./task-workspace-api";

vi.mock("./device-directory", () => ({
  useDeviceDirectory: () => ({
    status: {
      devices: [
        { id: "pc", model: "我的电脑", platform: "windows", online: true },
        { id: "phone", model: "手机", platform: "android", online: true },
      ],
    },
  }),
}));
vi.mock("./task-workspace-api", () => ({ taskWorkspaceRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const task: DeviceTask = {
  id: "from-phone",
  task: "整理文件",
  device_id: "pc",
  source_device: "phone",
  status: "awaiting_approval",
  current_step: 0,
  in_flight_step: null,
  steps: [
    {
      action: "desktop.write",
      arguments: { path: "notes.txt", content: "hello" },
    },
  ],
  results: [],
  revision: "displayed-plan",
  busy: false,
};

it("loads the phone task and approves only the displayed plan revision", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({ tasks: [task] });
  render(<DeviceTaskPanel />);
  fireEvent.click(await screen.findByText("确认计划并执行"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "approve",
      { id: "from-phone", revision: "displayed-plan" },
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByText("phone → pc")).toBeInTheDocument();
  expect(screen.getByText(/notes.txt/)).toBeInTheDocument();
});

it("requires explicit outcome review for an interrupted action", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [{ ...task, status: "paused", in_flight_step: 0 }],
  });
  render(<DeviceTaskPanel />);
  expect(await screen.findByText(/结果不明/)).toBeInTheDocument();
  expect(screen.queryByText("继续任务")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("已核对完成，继续"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "resume",
      { id: "from-phone", revision: "displayed-plan", resolution: "completed" },
      expect.any(AbortSignal),
    ),
  );
});

it("reuses the submission id if the network loses its response", async () => {
  vi.mocked(taskWorkspaceRequest).mockImplementation(async (command) => {
    if (command === "submit") throw new Error("网络断开");
    return { tasks: [] };
  });
  render(<DeviceTaskPanel />);
  fireEvent.change(screen.getByLabelText("执行设备"), {
    target: { value: "pc" },
  });
  fireEvent.change(screen.getByLabelText("任务内容"), {
    target: { value: "整理文件" },
  });
  fireEvent.click(screen.getByText("生成执行计划"));
  await screen.findByText("网络断开");
  fireEvent.click(screen.getByText("生成执行计划"));
  await waitFor(() =>
    expect(
      vi
        .mocked(taskWorkspaceRequest)
        .mock.calls.filter((c) => c[0] === "submit"),
    ).toHaveLength(2),
  );
  const calls = vi
    .mocked(taskWorkspaceRequest)
    .mock.calls.filter((c) => c[0] === "submit");
  expect(calls[0]?.[1]?.id).toBe(calls[1]?.[1]?.id);
});

it("does not poll hidden task sections", () => {
  render(<DeviceTaskSection />);
  expect(taskWorkspaceRequest).not.toHaveBeenCalled();
});

it("keeps successful steps unverified and submits a revision-bound human review", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [{ ...task, status: "succeeded", current_step: 1 }],
  });
  render(<DeviceTaskPanel />);
  expect(await screen.findByText(/结果待确认/)).toBeInTheDocument();
  expect(screen.queryByText("已由用户确认完成")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("我已核对，尚未完成"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "review_result",
      { id: task.id, revision: task.revision, outcome: "not_achieved" },
      expect.any(AbortSignal),
    ),
  );
  expect(
    vi
      .mocked(taskWorkspaceRequest)
      .mock.calls.some(([command]) => command === "resume"),
  ).toBe(false);
});

it("shows the shared reviewer and completed outcome after changing clients", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [
      {
        ...task,
        status: "succeeded",
        result_review: {
          outcome: "achieved",
          reviewed_by: "device:phone",
          reviewed_at: 1,
          revision: "evidence",
        },
      },
    ],
  });
  render(<DeviceTaskPanel />);
  expect(await screen.findByText("已由用户确认完成")).toBeInTheDocument();
  expect(screen.getByText("核对人：device:phone")).toBeInTheDocument();
  expect(screen.getByText("我已核对，确认完成")).toBeDisabled();
});

it("submits ordered device stages and preserves id when a workflow response is lost", async () => {
  vi.mocked(taskWorkspaceRequest).mockImplementation(async (command) => {
    if (command === "submit") throw new Error("交接任务提交超时");
    return { tasks: [] };
  });
  render(<DeviceTaskPanel />);
  fireEvent.click(screen.getByLabelText("多设备接续"));
  fireEvent.change(screen.getByLabelText("任务内容"), {
    target: { value: "电脑处理，手机接续" },
  });
  fireEvent.change(screen.getByLabelText("第 1 阶段设备"), {
    target: { value: "pc" },
  });
  fireEvent.change(screen.getByLabelText("第 1 阶段任务"), {
    target: { value: "整理资料" },
  });
  fireEvent.change(screen.getByLabelText("第 2 阶段设备"), {
    target: { value: "phone" },
  });
  fireEvent.change(screen.getByLabelText("第 2 阶段任务"), {
    target: { value: "查看结果" },
  });
  fireEvent.click(screen.getByText("生成执行计划"));
  await screen.findByText("交接任务提交超时");
  fireEvent.click(screen.getByText("生成执行计划"));
  await waitFor(() =>
    expect(
      vi
        .mocked(taskWorkspaceRequest)
        .mock.calls.filter((call) => call[0] === "submit"),
    ).toHaveLength(2),
  );
  const calls = vi
    .mocked(taskWorkspaceRequest)
    .mock.calls.filter((call) => call[0] === "submit");
  expect(calls[0]?.[1]).toEqual(calls[1]?.[1]);
  expect(calls[0]?.[1]).toMatchObject({
    task: "电脑处理，手机接续",
    stages: [
      { device_id: "pc", task: "整理资料" },
      { device_id: "phone", task: "查看结果" },
    ],
  });
});

it("requires reviewed stage completion before a revision-bound handoff", async () => {
  const workflow = {
    ...task,
    status: "awaiting_handoff",
    stage_index: 0,
    stages: [
      { device_id: "pc", task: "整理资料" },
      { device_id: "phone", task: "查看结果" },
    ],
  };
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({ tasks: [workflow] });
  const first = render(<DeviceTaskPanel />);
  expect(await screen.findByText("交给下一台设备规划")).toBeDisabled();
  expect(screen.getByText(/阶段 1 \/ 2/)).toBeInTheDocument();
  first.unmount();
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [
      {
        ...workflow,
        result_review: {
          outcome: "achieved",
          reviewed_by: "os",
          reviewed_at: 1,
          revision: "proof",
        },
      },
    ],
  });
  render(<DeviceTaskPanel />);
  fireEvent.click(await screen.findByText("交给下一台设备规划"));
  await waitFor(() =>
    expect(taskWorkspaceRequest).toHaveBeenCalledWith(
      "advance",
      { id: task.id, revision: task.revision },
      expect.any(AbortSignal),
    ),
  );
});

it("shows previous-device evidence while the next stage awaits approval", async () => {
  vi.mocked(taskWorkspaceRequest).mockResolvedValue({
    tasks: [
      {
        ...task,
        device_id: "phone",
        stage_index: 1,
        stages: [
          { device_id: "pc", task: "整理资料" },
          { device_id: "phone", task: "查看结果" },
        ],
        stage_history: [
          {
            device_id: "pc",
            task: "整理资料",
            result_review: { reviewed_by: "os-user" },
            results: [
              {
                step: 0,
                action: "file.write",
                success: true,
                summary: "saved-notes-on-pc",
              },
            ],
          },
        ],
      },
    ],
  });
  render(<DeviceTaskPanel />);
  expect(await screen.findByText(/阶段 2 \/ 2/)).toBeInTheDocument();
  expect(screen.getByText("saved-notes-on-pc")).toBeInTheDocument();
  expect(screen.getByText(/核对人：os-user/)).toBeInTheDocument();
  expect(screen.queryByText("交给下一台设备规划")).not.toBeInTheDocument();
});
