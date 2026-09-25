import { useSyncExternalStore } from "react";
import { currentActorId, getToken } from "@/core/auth/api";
import {
  phoneRequest,
  downloadPhoneFile,
  uploadPhoneFile,
  MAX_FILE_BYTES,
  type ExchangeFile,
} from "./phone-mirror-api";

export type PhoneTransfer = {
  id: string;
  deviceId: string;
  name: string;
  size: number;
  bytes: number;
  upload: boolean;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  file?: File;
  error?: string;
};
let jobs: PhoneTransfer[] = [];
let owner = "";
let sequence = 0;
const listeners = new Set<() => void>();
const active = new Map<string, AbortController>();
const scope = () => `${currentActorId()}:${getToken() || "cookie"}`;
const notify = () => listeners.forEach((listener) => listener());
const update = (id: string, patch: Partial<PhoneTransfer>) => {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
  notify();
};

export function resetPhoneTransfers() {
  active.forEach((controller) => controller.abort());
  active.clear();
  jobs = [];
  owner = scope();
  notify();
}
function ensureOwner() {
  if (owner !== scope()) resetPhoneTransfers();
}
async function pump(deviceId: string) {
  ensureOwner();
  if (active.has(deviceId)) return;
  const job = jobs.find(
    (candidate) =>
      candidate.deviceId === deviceId && candidate.state === "queued",
  );
  if (!job) return;
  const controller = new AbortController();
  active.set(deviceId, controller);
  const actor = owner;
  const watch = setInterval(() => {
    if (scope() !== actor) resetPhoneTransfers();
  }, 500);
  const live = () => owner === actor && active.get(deviceId) === controller;
  update(job.id, { state: "running", error: undefined });
  try {
    const progress = (bytes: number) => {
      if (live()) update(job.id, { bytes });
    };
    if (job.file)
      await uploadPhoneFile(
        deviceId,
        job.file,
        progress,
        controller.signal,
        job.id,
      );
    else {
      const blob = await downloadPhoneFile(
        deviceId,
        job,
        progress,
        controller.signal,
        job.id,
      );
      controller.signal.throwIfAborted();
      if (!live()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = job.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    if (live()) {
      update(job.id, { state: "done", file: undefined });
      void phoneRequest(job.deviceId, "transfers", {
        operation: "report",
        _transferId: job.id,
        state: "done",
      }).catch(() => {});
    }
  } catch (error) {
    if (live())
      void phoneRequest(job.deviceId, "transfers", {
        operation: "report",
        _transferId: job.id,
        state: controller.signal.aborted ? "cancelled" : "error",
      }).catch(() => {});
    if (live())
      update(job.id, {
        state: controller.signal.aborted ? "cancelled" : "error",
        error: error instanceof Error ? error.message : "传输失败",
      });
  } finally {
    clearInterval(watch);
    if (active.get(deviceId) === controller) {
      active.delete(deviceId);
      void pump(deviceId);
    }
  }
}

export function enqueuePhoneTransfer(
  deviceId: string,
  file: File | ExchangeFile,
  upload: boolean,
) {
  ensureOwner();
  if (file.size > MAX_FILE_BYTES) throw new Error("单文件上限为 100 MiB");
  if (
    jobs.filter((job) =>
      ["queued", "running", "error", "cancelled"].includes(job.state),
    ).length >= 20
  )
    throw new Error("传输队列最多保留 20 个未完成文件");
  // Keep bounded history and release completed File buffers.
  jobs = jobs.filter(
    (job) => job.state !== "done" || jobs.indexOf(job) >= jobs.length - 30,
  );
  const job: PhoneTransfer = {
    id: `transfer-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${++sequence}`}`,
    deviceId,
    name: file.name,
    size: file.size,
    bytes: 0,
    state: "queued",
    upload,
    ...(upload ? { file: file as File } : {}),
  };
  jobs = [...jobs, job];
  notify();
  void pump(deviceId);
  return job.id;
}
export function pausePhoneTransfer(id: string) {
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job) return;
  if (job.state === "running") active.get(job.deviceId)?.abort();
  else if (job.state === "queued") update(id, { state: "cancelled" });
}
export function retryPhoneTransfer(id: string) {
  ensureOwner();
  const job = jobs.find((candidate) => candidate.id === id);
  if (!job || !["error", "cancelled"].includes(job.state)) return;
  update(id, { state: "queued" });
  void pump(job.deviceId);
}
export function dismissPhoneTransfer(id: string) {
  const job = jobs.find((candidate) => candidate.id === id);
  if (job?.state === "running") return;
  jobs = jobs.filter((candidate) => candidate.id !== id);
  notify();
}
export function usePhoneTransfers() {
  return useSyncExternalStore(
    (listener) => {
      ensureOwner();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => jobs,
    () => jobs,
  );
}
