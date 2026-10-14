import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchDeviceLinkStatus } from "./device-link";
import { publishDeviceStatus, refreshDeviceDirectory, useDeviceDirectory } from "./device-directory";

vi.mock("./device-link", () => ({ fetchDeviceLinkStatus: vi.fn() }));
vi.mock("./nearby-devices", () => ({ fetchNearbyDevices: vi.fn(async () => []) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("shares one inventory request and removes stale online state on failure", async () => {
  vi.mocked(fetchDeviceLinkStatus).mockResolvedValue({ devices: [{ id: "phone", online: true }] } as Awaited<ReturnType<typeof fetchDeviceLinkStatus>>);
  const radar = renderHook(() => useDeviceDirectory());
  const mirror = renderHook(() => useDeviceDirectory());
  await waitFor(() => expect(mirror.result.current.status?.devices[0]?.online).toBe(true));
  expect(fetchDeviceLinkStatus).toHaveBeenCalledTimes(1);
  expect(radar.result.current).toBe(mirror.result.current);
  vi.mocked(fetchDeviceLinkStatus).mockRejectedValue(new Error("offline"));
  await act(async () => refreshDeviceDirectory());
  expect(radar.result.current.status).toBeNull();
  expect(mirror.result.current.error).toBe("offline");
});

it("does not restore a revoked device from an older in-flight inventory", async () => {
  type Status = Awaited<ReturnType<typeof fetchDeviceLinkStatus>>;
  let finish!: (status: Status) => void;
  vi.mocked(fetchDeviceLinkStatus).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const directory = renderHook(() => useDeviceDirectory());
  await act(async () => {
    publishDeviceStatus({ devices: [] } as unknown as Status);
    finish({ devices: [{ id: "revoked", online: true }] } as unknown as Status);
  });
  expect(directory.result.current.status?.devices).toEqual([]);
});
