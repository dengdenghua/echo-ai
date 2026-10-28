import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

type Mode = "denied" | "view" | "control";
type HostStatus = {
  state: string;
  relayConfigured: boolean;
  permissions: Record<string, Mode>;
  active: { deviceId: string; state: string; permission: Mode }[];
};

async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<HostStatus> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/tentacle/remote-desktop/${path}`,
    {
      method,
      credentials: "include",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok)
    throw new Error("无法更新电脑远控设置，请确认设备连接和管理员登录状态。");
  return response.json();
}

export function RemoteDesktopHost({
  deviceId,
  online,
}: {
  deviceId: string;
  online: boolean;
}) {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const changing = useRef(false);
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const version = revision.current;
    try {
      const next = await request("status");
      if (version !== revision.current) return;
      setStatus(next);
      setError("");
    } catch (failure) {
      if (version === revision.current) setError((failure as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const update = async (path: string, method: string, body?: unknown) => {
    revision.current++;
    changing.current = true;
    setBusy(true);
    try {
      setStatus(await request(path, method, body));
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  };
  const message =
    status?.state === "component_missing"
      ? "远控组件尚未就绪，请更新 Echo 桌面端。"
      : status?.state === "display_unavailable"
        ? "当前主机没有可共享的桌面，请连接正在使用的电脑。"
        : status?.state === "network_config_invalid"
          ? "跨网连接配置需要修复。"
          : "允许后，在手机的“电脑远控”中连接。直连失败时自动使用兼容连接。";
  return (
    <section
      aria-label="手机控制这台电脑"
      className="border-t border-border bg-card px-3 py-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="font-medium" htmlFor="remote-desktop-permission">
          手机控制这台电脑
        </label>
        <select
          id="remote-desktop-permission"
          aria-label="此手机的电脑远控权限"
          className="rounded border border-border bg-background px-2 py-1"
          value={status?.permissions[deviceId] ?? "denied"}
          disabled={busy || !deviceId || !status}
          onChange={(event) =>
            void update(`permissions/${encodeURIComponent(deviceId)}`, "PUT", {
              mode: event.target.value,
            })
          }
        >
          <option value="denied">不允许</option>
          <option value="view" disabled={!online || status?.state !== "ready"}>
            仅观看画面
          </option>
          <option
            value="control"
            disabled={!online || status?.state !== "ready"}
          >
            允许观看与操作
          </option>
        </select>
        {!!status?.active.length && (
          <button
            type="button"
            disabled={busy}
            className="rounded border border-border px-2 py-1"
            onClick={() => void update("stop", "POST")}
          >
            结束当前远控
          </button>
        )}
      </div>
      <p className="mt-2 text-muted-foreground">{message}</p>
      {status?.permissions[deviceId] === "control" && (
        <p className="mt-1 text-muted-foreground">
          此手机可以查看屏幕并操作鼠标与键盘。改为“不允许”会立即断开并撤销权限。
        </p>
      )}
      {!!status?.active.length && (
        <p role="status" className="mt-2">
          正在远控：{status.active.map((s) => s.deviceId).join("、")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
