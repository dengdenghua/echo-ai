import { authHeaders as authHeader } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export type NearbyDevice = { id: string; name: string; platform: string; address: string };
export async function fetchNearbyDevices(): Promise<NearbyDevice[]> {
  const response = await fetch(`${getBackendBaseURL()}/api/tentacle/discovery`, { headers: authHeader() });
  if (!response.ok) throw new Error("局域网发现暂不可用");
  const body = await response.json();
  return Array.isArray(body.devices) ? body.devices : [];
}
