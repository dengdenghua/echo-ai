import { resetPhoneTransfers } from "./phone-transfers";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneMirrorApp } from "./phone-mirror-app";
import { fetchDeviceLinkStatus } from "./device-link";
import { phoneRequest, uploadPhoneFile } from "./phone-mirror-api";

vi.mock("./device-link", () => ({ fetchDeviceLinkStatus: vi.fn() }));
vi.mock("./phone-mirror-api", () => ({
  MAX_FILE_BYTES: 100 * 1024 * 1024,
  phoneRequest: vi.fn(),
  uploadPhoneFile: vi.fn(),
  downloadPhoneFile: vi.fn(),
}));
const status = (devices: unknown[]) =>
  ({ devices }) as Awaited<ReturnType<typeof fetchDeviceLinkStatus>>;
beforeEach(() => {
  vi.mocked(fetchDeviceLinkStatus).mockResolvedValue(status([]));
  vi.mocked(phoneRequest).mockImplementation(async (_id, operation) =>
    operation === "frame"
      ? { jpeg: "c2NyZWVu", width: 720, height: 1280 }
      : operation === "files"
        ? { files: [], total: 0 }
        : { applied: true },
  );
});
afterEach(() => {
  cleanup();
  resetPhoneTransfers();
  vi.clearAllMocks();
});

describe("real phone mirror", () => {
  const phone = () =>
    vi
      .mocked(fetchDeviceLinkStatus)
      .mockResolvedValue(
        status([{ id: "phone", platform: "android", online: true }]),
      );
  it("commits Chinese composition once and pastes without replacing the entire field", async () => {
    phone();
    render(<PhoneMirrorApp />);
    await screen.findByAltText("手机实时画面");
    const input = screen.getByRole("textbox", { name: "手机键盘输入" });
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: "ni" } });
    fireEvent.input(input, { target: { value: "你好" } });
    expect(
      vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
    ).toHaveLength(0);
    fireEvent.compositionEnd(input);
    fireEvent.input(input);
    await waitFor(() =>
      expect(phoneRequest).toHaveBeenCalledWith("phone", "control", {
        action: "edit",
        command: "insert",
        text: "你好",
        aspect: 720 / 1280,
      }),
    );
    fireEvent.paste(input, { clipboardData: { getData: () => " Echo" } });
    await waitFor(() =>
      expect(
        vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
      ).toHaveLength(2),
    );
    expect(phoneRequest).toHaveBeenLastCalledWith("phone", "control", {
      action: "edit",
      command: "insert",
      text: " Echo",
      aspect: 720 / 1280,
    });
  });
  it("serializes typing behind an in-flight edit and stops queued input after failure", async () => {
    phone();
    render(<PhoneMirrorApp />);
    await screen.findByAltText("手机实时画面");
    let reject!: (error: Error) => void;
    vi.mocked(phoneRequest).mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const input = screen.getByRole("textbox", { name: "手机键盘输入" });
    fireEvent.input(input, { target: { value: "a" } });
    fireEvent.input(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(
      vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
    ).toHaveLength(1);
    reject(new Error("连接中断"));
    await screen.findByText(/后续输入已停止/);
    expect(
      vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
    ).toHaveLength(1);
  });
  it("opens the transfer drawer when dropping on the phone workspace", async () => {
    phone();
    render(<PhoneMirrorApp />);
    await screen.findByAltText("手机实时画面");
    expect(
      screen.queryByRole("complementary", { name: "文件收发" }),
    ).toBeNull();
    const file = new File(["hello"], "hello.txt");
    fireEvent.drop(screen.getByTestId("phone-mirror-container"), {
      dataTransfer: { files: [file] },
    });
    await waitFor(() =>
      expect(uploadPhoneFile).toHaveBeenCalledWith(
        "phone",
        file,
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(String),
      ),
    );
    expect(
      screen.getByRole("complementary", { name: "文件收发" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/已送达/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起文件" }));
    expect(
      screen.queryByRole("complementary", { name: "文件收发" }),
    ).toBeNull();
  });
  it("discards queued edits when switching phones", async () => {
    vi.mocked(fetchDeviceLinkStatus).mockResolvedValue(
      status([
        { id: "first", platform: "android", online: true },
        { id: "second", platform: "android", online: true },
      ]),
    );
    render(<PhoneMirrorApp />);
    await screen.findByAltText("手机实时画面");
    let finish!: (value: unknown) => void;
    vi.mocked(phoneRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const input = screen.getByRole("textbox", { name: "手机键盘输入" });
    fireEvent.input(input, { target: { value: "a" } });
    fireEvent.input(input, { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("选择手机"), {
      target: { value: "second" },
    });
    await waitFor(() =>
      expect(phoneRequest).toHaveBeenCalledWith(
        "second",
        "frame",
        {},
        expect.any(AbortSignal),
      ),
    );
    finish({ applied: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "主页" })).toBeEnabled(),
    );
    expect(
      vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
    ).toHaveLength(1);
  });
  it("batches adjacent committed text while keeping deletion in order", async () => {
    phone();
    render(<PhoneMirrorApp />);
    await screen.findByAltText("手机实时画面");
    let finish!: (value: unknown) => void;
    vi.mocked(phoneRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const input = screen.getByRole("textbox", { name: "手机键盘输入" });
    for (const value of ["a", "b", "c", "你好"])
      fireEvent.input(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Backspace" });
    finish({ applied: true });
    await waitFor(() =>
      expect(
        vi.mocked(phoneRequest).mock.calls.filter(([, op]) => op === "control"),
      ).toHaveLength(3),
    );
    expect(
      vi
        .mocked(phoneRequest)
        .mock.calls.filter(([, op]) => op === "control")
        .map(([, , args]) => args),
    ).toEqual([
      { action: "edit", command: "insert", text: "a", aspect: 720 / 1280 },
      { action: "edit", command: "insert", text: "bc你好", aspect: 720 / 1280 },
      { action: "edit", command: "delete_backward", aspect: 720 / 1280 },
    ]);
  });
  it("shows pairing guidance without invented devices or telemetry", async () => {
    render(<PhoneMirrorApp />);
    expect(
      await screen.findByText("先在设备连接中配对手机"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/iPhone|24ms|849201/)).toBeNull();
    expect(screen.getByRole("button", { name: "主页" })).toBeDisabled();
    expect(phoneRequest).not.toHaveBeenCalled();
  });
  it("uses the selected ID for frame and navigation even when names match", async () => {
    vi.mocked(fetchDeviceLinkStatus).mockResolvedValue(
      status([
        { id: "real", platform: "android", model: "Pixel", online: true },
        { id: "virtual", platform: "android", model: "Pixel", online: true },
      ]),
    );
    render(<PhoneMirrorApp deviceId="virtual" />);
    expect(await screen.findByAltText("手机实时画面")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "主页" }));
    await waitFor(() =>
      expect(phoneRequest).toHaveBeenCalledWith("virtual", "control", {
        action: "home",
        aspect: 720 / 1280,
      }),
    );
    expect(
      vi.mocked(phoneRequest).mock.calls.every(([id]) => id === "virtual"),
    ).toBe(true);
  });
  it("reports missing permission without displaying a simulated screen", async () => {
    vi.mocked(fetchDeviceLinkStatus).mockResolvedValue(
      status([{ id: "phone", platform: "android", online: true }]),
    );
    vi.mocked(phoneRequest).mockRejectedValue(new Error("请开启无障碍权限"));
    render(<PhoneMirrorApp />);
    expect(await screen.findByText("暂时无法显示画面")).toBeInTheDocument();
    expect(screen.queryByAltText("手机实时画面")).toBeNull();
  });
});
