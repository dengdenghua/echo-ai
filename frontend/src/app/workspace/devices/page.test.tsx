import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

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
  vi.mocked(listDevices).mockRejectedValue(
    new Error("authentication required"),
  );
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "authentication required",
  );
  expect(screen.queryByText("连接第一台设备")).not.toBeInTheDocument();
});
