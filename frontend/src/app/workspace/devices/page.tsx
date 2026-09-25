import { DeviceTaskSection } from "@/components/device-interconnect/device-task-panel";
import { useEffect, useState } from "react";
import {
  useDeviceDirectory,
  refreshDeviceDirectory,
} from "@/components/device-interconnect/device-directory";
import type { LinkedDevice } from "@/components/device-interconnect/device-link";
import { PhoneTransferList } from "@/components/device-interconnect/phone-transfer-list";
import { Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { PhoneMirrorApp } from "@/components/device-interconnect/phone-mirror-app";

const button =
  "rounded-xl border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40";

function deviceName(device: LinkedDevice) {
  return (
    [device.brand, device.model]
      .filter((value) => typeof value === "string" && value)
      .join(" ") || device.id
  );
}

export default function DevicesPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("device") || "";
  const directory = useDeviceDirectory();
  const [opened, setOpened] = useState<string[]>(() =>
    selected ? [selected] : [],
  );
  const [pip, setPip] = useState(false);
  useEffect(() => {
    if (selected)
      setOpened((previous) =>
        previous.includes(selected) ? previous : [...previous, selected],
      );
  }, [selected]);
  const query = {
    data: directory.status?.devices,
    error: directory.error ? new Error(directory.error) : null,
    isPending: directory.loading,
    isFetching: directory.loading,
    refetch: refreshDeviceDirectory,
  };
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("device", id);
    else next.delete("device");
    setParams(next);
  };
  return (
    <main className="flex h-full min-h-0 flex-col overflow-auto bg-background p-4 sm:p-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">设备互联</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            在电脑上操作手机，拖入文件即可发送。
          </p>
        </div>
        <button
          className={button}
          aria-label="刷新设备列表"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {query.isPending && <p role="status">正在读取设备…</p>}
      {query.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          无法读取设备：{query.error.message}。请检查登录和设备服务连接。
        </p>
      )}
      {!query.isPending && !query.error && !query.data?.length && (
        <section className="rounded-2xl border p-6 text-sm text-muted-foreground">
          <h2 className="mb-2 font-medium text-foreground">连接第一台设备</h2>
          <p>
            在手机 Echo 中连接当前服务；使用 Echo OS 时，可从 OS
            的设备连接面板配对。
          </p>
          <p className="mt-2">
            实体设备、Android 模拟器和虚拟电脑连接后都会出现在这里。
          </p>
        </section>
      )}
      <div className="grid min-h-0 flex-1 items-start gap-5 lg:grid-cols-[minmax(240px,340px)_minmax(0,1fr)]">
        <section aria-label="已连接设备" className="space-y-3">
          {directory.nearby
            .filter(
              (item) => !query.data?.some((device) => device.id === item.id),
            )
            .map((device) => (
              <p key={device.id} className="rounded-2xl border p-4 text-sm">
                {device.name} · 附近待配对
                <br />
                <span className="text-xs text-muted-foreground">
                  {device.address} · 在 OS 设备连接中创建邀请，手机确认后接入。
                </span>
              </p>
            ))}
          {query.data?.map((device) => (
            <article key={device.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-3">
                {device.platform === "android" ? (
                  <Smartphone size={22} />
                ) : (
                  <Monitor size={22} />
                )}
                <div className="min-w-0">
                  <h2
                    className="truncate font-medium"
                    title={deviceName(device)}
                  >
                    {deviceName(device)}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {device.platform} ·{" "}
                    {device.online ? (device.busy ? "忙碌" : "在线") : "离线"}
                  </p>
                </div>
              </div>
              <p className="my-3 break-all font-mono text-xs text-muted-foreground">
                {device.id}
              </p>
              {device.platform === "android" ? (
                <button
                  className={button}
                  disabled={!device.online}
                  onClick={() => select(device.id)}
                >
                  打开手机
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {device.totalCapabilities} 项已注册能力 ·
                  可在任务成员中选择此设备
                </p>
              )}
            </article>
          ))}
        </section>
        <div className="space-y-3">
          {opened.map((id) => (
            <section
              key={id}
              hidden={selected !== id}
              aria-label="手机协同窗口"
              className={
                pip
                  ? "fixed bottom-4 right-4 z-50 h-[480px] w-[360px] max-w-[95vw] overflow-hidden rounded-2xl border bg-white shadow-xl"
                  : "relative h-[min(780px,80vh)] min-h-[480px] w-full max-w-[960px] overflow-hidden rounded-2xl border shadow-sm"
              }
            >
              <div className="flex h-8 items-center justify-end border-b bg-slate-50 px-3">
                <button
                  className="rounded border bg-white px-2 py-0.5 text-xs text-slate-700"
                  aria-label={pip ? "恢复手机窗口" : "切换为悬浮小窗"}
                  onClick={() => setPip(!pip)}
                >
                  {pip ? "恢复窗口" : "悬浮小窗"}
                </button>
              </div>
              <div className="h-[calc(100%-2rem)]">
                <PhoneMirrorApp
                  deviceId={id}
                  onClose={() => {
                    setOpened((previous) =>
                      previous.filter((entry) => entry !== id),
                    );
                    select("");
                  }}
                />
              </div>
            </section>
          ))}
          {!selected && !!query.data?.length && (
            <p className="p-6 text-sm text-muted-foreground">
              选择一台在线手机，即可操作手机和收发文件。
            </p>
          )}
          <DeviceTaskSection />
          <details>
            <summary className="cursor-pointer text-sm">全部文件传输</summary>
            <PhoneTransferList />
          </details>
        </div>
      </div>
    </main>
  );
}
