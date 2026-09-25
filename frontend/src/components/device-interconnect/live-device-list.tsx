import { useDeviceDirectory } from "./device-directory";
import type { LinkedDevice } from "./device-link";

export function LiveDeviceList({
  onOpen,
  enabled = true,
}: {
  onOpen?: (device: LinkedDevice) => void;
  enabled?: boolean;
}) {
  const { status, error, loading, nearby } = useDeviceDirectory(enabled);
  return (
    <section aria-label="真实设备列表" className="space-y-2 text-xs">
      {loading && <p>正在读取设备…</p>}
      {error && <p role="alert">{error}</p>}
      {status && (
        <p>
          {status.devices.filter((device) => device.online).length} 台在线 ·{" "}
          {status.devices.length} 台设备
        </p>
      )}
      {status && !status.devices.length && (
        <p>尚无已配对设备，请在设备连接中添加。</p>
      )}
      {status?.devices.map((device) => (
        <div
          key={device.id}
          className="flex items-center gap-2 rounded-lg border border-slate-200/60 p-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate">
              {[device.brand, device.model].filter(Boolean).join(" ") ||
                device.id}
            </p>
            <p
              className="truncate text-[10px] text-slate-500"
              title={device.id}
            >
              {device.platform} · {device.online ? "在线" : "离线"} ·{" "}
              {device.id}
            </p>
          </div>
          {device.platform === "android" && onOpen ? (
            <button
              type="button"
              disabled={!device.online}
              onClick={() => onOpen(device)}
              className="rounded bg-blue-600 px-2 py-1 text-white disabled:opacity-40"
            >
              打开手机
            </button>
          ) : (
            <span className="text-[10px] text-slate-500">
              {device.capabilities?.length || 0} 项能力
            </span>
          )}
        </div>
      ))}
      {nearby
        .filter(
          (candidate) =>
            !status?.devices.some((device) => device.id === candidate.id),
        )
        .map((device) => (
          <p key={device.id} className="rounded border p-2">
            {device.name} · 附近待配对
            <br />
            <span className="text-[10px] text-slate-500">
              {device.address} · 在设备连接中创建邀请，手机确认后才能操作
            </span>
          </p>
        ))}
    </section>
  );
}
