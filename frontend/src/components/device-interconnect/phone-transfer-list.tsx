import { useEffect, useState } from "react";
import { phoneRequest } from "./phone-mirror-api";
import {
  dismissPhoneTransfer,
  pausePhoneTransfer,
  retryPhoneTransfer,
  usePhoneTransfers,
  type PhoneTransfer,
} from "./phone-transfers";

export function PhoneTransferList({ deviceId }: { deviceId?: string }) {
  const jobs = usePhoneTransfers().filter(
    (job) => !deviceId || job.deviceId === deviceId,
  );
  const [remote, setRemote] = useState<
    (PhoneTransfer & { updatedAt: number })[]
  >([]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await phoneRequest<{
          jobs: (PhoneTransfer & { updatedAt: number })[];
        }>(deviceId || "all", "transfers", {}, abort.signal);
        if (!abort.signal.aborted)
          setRemote(Array.isArray(result.jobs) ? result.jobs : []);
      } catch {
        if (!abort.signal.aborted) setRemote([]);
      }
      if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [deviceId]);
  return (
    <section aria-label="统一传输队列" className="space-y-2 text-xs">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-xl border border-slate-200 bg-white p-3 text-slate-700"
        >
          <p className="truncate font-medium">{job.name}</p>
          <p className="mt-1 break-all text-[10px]">
            {job.upload
              ? `此电脑 → ${job.deviceId}`
              : `${job.deviceId} → 此电脑下载`}
          </p>
          <progress
            aria-label="文件传输进度"
            className="mt-2 h-1.5 w-full"
            value={job.bytes}
            max={Math.max(job.size, 1)}
          />
          <p>
            {job.bytes} / {job.size} B ·{" "}
            {
              {
                queued: "等待传输",
                running: "传输中",
                done: "校验完成",
                error: "传输失败",
                cancelled: job.upload ? "已暂停，可续传" : "已取消下载",
              }[job.state]
            }
          </p>
          {job.state === "done" && (
            <p className="mt-1 text-emerald-700">
              {job.upload
                ? "已送达。手机 Echo 文件收发中可打开、分享或保存。"
                : "已交给浏览器下载，可在下载列表打开。"}
            </p>
          )}
          {job.state === "error" && <p role="alert">{job.error}</p>}
          <div className="mt-2 flex gap-3">
            {["running", "queued"].includes(job.state) && (
              <button onClick={() => pausePhoneTransfer(job.id)}>
                {job.upload ? "暂停" : "取消下载"}
              </button>
            )}
            {["error", "cancelled"].includes(job.state) && (
              <button onClick={() => retryPhoneTransfer(job.id)}>
                {job.upload ? "继续传输" : "重新下载"}
              </button>
            )}
            {job.state !== "running" && (
              <button onClick={() => dismissPhoneTransfer(job.id)}>
                移除记录
              </button>
            )}
          </div>
        </div>
      ))}
      {remote
        .filter(
          (job) =>
            (!deviceId || job.deviceId === deviceId) &&
            !jobs.some((local) => local.id === job.id),
        )
        .map((job) => (
          <div key={job.id} className="rounded-xl border p-3">
            <p>
              {job.name} ·{" "}
              {job.upload ? `电脑 → ${job.deviceId}` : `${job.deviceId} → 电脑`}
            </p>
            <p>
              {job.bytes} / {job.size} B ·{" "}
              {job.state === "done"
                ? "校验完成"
                : job.state === "error"
                  ? "传输失败"
                  : job.state === "cancelled"
                    ? "已暂停"
                    : Date.now() / 1000 - job.updatedAt > 15
                      ? "状态待确认"
                      : "传输中"}
            </p>
            <p className="text-[10px] text-slate-500">
              其他窗口发起 · 暂停或续传请回到发起窗口
            </p>
          </div>
        ))}
    </section>
  );
}
