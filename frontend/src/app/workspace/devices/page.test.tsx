import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { EchoAPIError } from "@/core/api/client";
import { listDevices } from "@/core/tentacle/api";
import DevicesPage from "./page";

vi.mock("@/core/tentacle/api", () => ({ listDevices: vi.fn() }));
vi.mock("@/components/device-interconnect/phone-mirror-app", () => ({
  PhoneMirrorApp: ({
    deviceId,
    onClose,
  }: {
    deviceId: string;
    onClose: () => void;
  }) => (
    <div>
      同屏目标 {deviceId}
      <button onClick={onClose}>关闭同屏</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/workspace/devices?surface=chat"]}>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("opens the selected phone while showing desktops and blocking offline phones", async () => {
  vi.mocked(listDevices).mockResolvedValue([
    {
      tentacle_id: "phone-a",
      platform: "android",
      is_online: true,
      meta: { model: "我的手机" },
    },
    { tentacle_id: "phone-b", platform: "android", is_online: false, meta: {} },
    {
      tentacle_id: "pc",
      platform: "windows",
      is_online: true,
      total_capabilities: 5,
      meta: {},
    },
  ] as Awaited<ReturnType<typeof listDevices>>);
  mount();
  await screen.findByText("我的手机");
  expect(screen.getByText(/5 项已注册能力/)).toBeInTheDocument();
  const actions = screen.getAllByRole("button", { name: "打开手机" });
  expect(actions[1]).toBeDisabled();
  fireEvent.click(actions[0]!);
  expect(screen.getByText("同屏目标 phone-a")).toBeInTheDocument();
  fireEvent.click(screen.getByText("关闭同屏"));
  expect(screen.queryByLabelText("手机协同窗口")).not.toBeInTheDocument();
});

it("shows connection failures instead of presenting an empty successful inventory", async () => {
  vi.mocked(listDevices).mockRejectedValue(new Error("connect ECONNREFUSED"));
  mount();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("暂时读不到设备列表");
  expect(alert).not.toHaveTextContent("ECONNREFUSED");
  expect(screen.queryByText("连接第一台设备")).not.toBeInTheDocument();
});

it.each([
  [401, "missing tentacle auth token", "登录后才能查看设备"],
  [403, "admin/operator role required", "设备互联需要管理员权限"],
])(
  "explains a %i refusal once and stops polling the device hub",
  async (status, detail, title) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(listDevices).mockRejectedValue(
        new EchoAPIError(detail, status, detail),
      );
      mount();
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByText(detail)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("跨端任务")).not.toBeInTheDocument();
      const calls = vi.mocked(listDevices).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(vi.mocked(listDevices).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  },
);
