import { useEffect, useState } from "react";
import { phoneRequest } from "./phone-mirror-api";
import {
  dismissPhoneTransfer,
  pausePhoneTransfer,
  recoverPhoneTransfer,
  reconcilePhoneTransfers,
  retryPhoneTransfer,
  usePhoneTransfers,
  type PhoneTransfer,
} from "./phone-transfers";

function RecoverTransfer({ job }: { job: PhoneTransfer }) {
  const [error, setError] = useState("");
  const recover = (file?: File) => {
    try {
      recoverPhoneTransfer(job, file);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
    }
  };
  return (
    <div className="mt-2 space-y-1">
      {job.upload ? (
        <label className="inline-flex cursor-pointer text-blue-700">
          选择原文件继续传输
          <input
            type="file"
            className="sr-only"
            aria-label={`选择原文件继续传输：${job.name}`}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) recover(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      ) : (
        <button onClick={() => recover()}>重新下载</button>
      )}
      <p className="text-[10px] text-slate-500">
        {job.upload
          ? "校验原文件后，从手机已确认的位置继续。"
          : "将从头下载并重新校验文件。"}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

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
        if (!abort.signal.aborted) {
          const receipts = Array.isArray(result.jobs) ? result.jobs : [];
          reconcilePhoneTransfers(receipts);
          setRemote(receipts);
        }
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
                interrupted: "传输已中断",
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
                    : job.state === "interrupted"
                      ? "传输已中断，可恢复"
                      : Date.now() / 1000 - job.updatedAt > 15
                        ? "状态待确认"
                        : "传输中"}
            </p>
            {["error", "cancelled", "interrupted"].includes(job.state) ? (
              <RecoverTransfer job={job} />
            ) : (
              job.state === "running" && (
                <p className="text-[10px] text-slate-500">
                  其他窗口正在传输；关闭原页面后，约 45 秒可在这里恢复。
                </p>
              )
            )}
          </div>
        ))}
    </section>
  );
}
