import { listDevices } from "@/core/tentacle/api";

/** Shell adapter: the same phone UI uses the AI session and its selected backend. */
export type LinkedDevice = {
  id: string;
  capabilities: string[];
  totalCapabilities: number;
  busy: boolean;
  platform: string;
  online: boolean;
  brand: string;
  model: string;
};

export async function fetchDeviceLinkStatus(): Promise<{
  devices: LinkedDevice[];
}> {
  const devices = await listDevices();
  return {
    devices: devices.map((device) => ({
      id: device.tentacle_id,
      capabilities: device.capabilities,
      totalCapabilities: device.total_capabilities,
      busy: device.is_busy,
      platform: device.platform,
      online: device.is_online,
      brand: typeof device.meta?.brand === "string" ? device.meta.brand : "",
      model: typeof device.meta?.model === "string" ? device.meta.model : "",
    })),
  };
}
