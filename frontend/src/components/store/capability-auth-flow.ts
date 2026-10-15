import {
  getCapabilityDeviceFlow,
  getCapabilityStatus,
  type CapabilityInfo,
} from "@/core/agents/agent-world-api";
import { oauthStatus } from "@/core/mcp/api";

// 插件市场的授权轮询:网页 OAuth 回调轮询 + CLI 设备流监控。

export function pollOAuth(
  server: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const st = await oauthStatus(server);
        if (st.authorized) {
          resolve(true);
          return;
        }
      } catch {
        // 网络抖动忽略,继续轮询
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(() => void tick(), 1500);
    };
    void tick();
  });
}

const DEVICE_FLOW_POLL_INTERVAL_MS = 2_000;
const DEVICE_FLOW_CLOSE_TIMEOUT_MS = 10_000;

export class DeviceFlowCloseTimeoutError extends Error {}

export function waitForDeviceFlowClose<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new DeviceFlowCloseTimeoutError()),
      DEVICE_FLOW_CLOSE_TIMEOUT_MS,
    );
    void operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function supportsDeviceFlow(capability: CapabilityInfo): boolean {
  return (
    capability.source === "connector" &&
    (capability.type === "cli" || Boolean(capability.has_cli_auth))
  );
}

function waitForDeviceFlowPoll(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollCapabilityDeviceFlow(
  capabilityId: string,
  expectedFlowId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<"connected" | "inactive" | "replaced" | "timeout" | "cancelled"> {
  const startedAt = Date.now();
  while (!signal.aborted) {
    try {
      const status = await getCapabilityStatus(capabilityId);
      if (signal.aborted) return "cancelled";
      if (status.connected) return "connected";
    } catch {
      // A transient status failure is retried while the server still reports
      // an active device-flow session.
    }

    try {
      const flow = await getCapabilityDeviceFlow(capabilityId);
      if (signal.aborted) return "cancelled";
      if (!flow.active || !flow.device_flow) return "inactive";
      if (flow.device_flow.flow_id !== expectedFlowId) return "replaced";
    } catch {
      // Fail closed at the deadline; never infer success from a network error.
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) return "timeout";
    const shouldContinue = await waitForDeviceFlowPoll(
      Math.min(DEVICE_FLOW_POLL_INTERVAL_MS, timeoutMs - elapsed),
      signal,
    );
    if (!shouldContinue) return "cancelled";
  }
  return "cancelled";
}
