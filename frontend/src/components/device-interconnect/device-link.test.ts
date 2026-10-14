import { afterEach, expect, it, vi } from "vitest";
import { fetchDeviceLinkStatus } from "./device-link";
import { phoneRequest } from "./phone-mirror-api";
import { listDevices } from "@/core/tentacle/api";

vi.mock("@/core/config", () => ({
  getBackendBaseURL: () => "https://echo.example",
}));
vi.mock("@/core/auth/api", () => ({
  authHeaders: () => ({ Authorization: "Bearer session" }),
}));
afterEach(() => vi.unstubAllGlobals());

it("uses the same authenticated backend for AI inventory, phone control and file transfer", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: "Bearer session" });
    return {
      ok: true,
      json: async () =>
        init?.method === "POST"
          ? { applied: true }
          : [
              {
                tentacle_id: "phone:one",
                platform: "android",
                is_online: true,
                meta: { model: "Phone" },
              },
            ],
    };
  });
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await listDevices(signal);
  expect(fetcher).toHaveBeenLastCalledWith(
    "https://echo.example/api/tentacle/devices",
    expect.objectContaining({ signal }),
  );
  expect((await fetchDeviceLinkStatus()).devices[0]).toMatchObject({
    id: "phone:one",
    online: true,
    model: "Phone",
  });
  await phoneRequest("phone:one", "control", { action: "home" }, signal);
  expect(fetcher).toHaveBeenLastCalledWith(
    "https://echo.example/api/tentacle/devices/phone%3Aone/mirror/control",
    expect.objectContaining({ signal, method: "POST" }),
  );
  await phoneRequest("phone:one", "files", { operation: "list" });
  expect(fetcher).toHaveBeenLastCalledWith(
    "https://echo.example/api/tentacle/devices/phone%3Aone/mirror/files",
    expect.anything(),
  );
});
