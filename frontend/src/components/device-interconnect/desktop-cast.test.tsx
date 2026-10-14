import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopCast } from "./desktop-cast";
import { phoneRequest } from "./phone-mirror-api";
vi.mock("./phone-mirror-api", () => ({ phoneRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("stops capture when the selected receiver is not ready and never shows success", async () => {
  const stop = vi.fn();
  const track = { stop, addEventListener: vi.fn() };
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) } });
  vi.mocked(phoneRequest).mockRejectedValue(new Error("请先打开接收页"));
  render(<DesktopCast deviceId="phone-one" online />);
  fireEvent.click(screen.getByText("共享电脑画面"));
  expect(await screen.findByRole("alert")).toHaveTextContent("请先打开接收页");
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByText("正在发送电脑画面")).toBeNull();
});

it("binds captured frames to one session and stops on unmount", async () => {
  const stop = vi.fn();
  const track = { stop, addEventListener: vi.fn() };
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(360);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frame");
  vi.mocked(phoneRequest).mockImplementation(async (_id, _op, args) => args?.operation === "start" ? { sessionId: "session-one" } : { delivered: true });
  const view = render(<DesktopCast deviceId="phone-one" online />);
  fireEvent.click(screen.getByText("共享电脑画面"));
  await screen.findByText("正在发送电脑画面");
  expect(phoneRequest).toHaveBeenCalledWith("phone-one", "cast", { operation: "frame", sessionId: "session-one", jpeg: "frame" }, expect.any(AbortSignal));
  view.unmount();
  expect(stop).toHaveBeenCalled();
  await waitFor(() => expect(phoneRequest).toHaveBeenLastCalledWith("phone-one", "cast", { operation: "stop", sessionId: "session-one" }));
});
