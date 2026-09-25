import { authHeaders as authHeader } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";

export type PhoneFrame = {
  jpeg: string;
  width: number;
  height: number;
  capturedAt: number;
};
export type ExchangeFile = { name: string; size: number };
export const CHUNK_BYTES = 12 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function phoneRequest<T>(
  id: string,
  operation: "frame" | "control" | "files" | "cast" | "transfers",
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/tentacle/devices/${encodeURIComponent(id)}/mirror/${operation}`,
    {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal,
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof result?.detail === "string"
        ? result.detail
        : `连接失败 (${response.status})`,
    );
  if (!result || typeof result !== "object") throw new Error("设备响应不完整");
  return result as T;
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("文件校验需要 HTTPS 或本机 localhost 连接");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadPhoneFile(
  id: string,
  file: File,
  progress: (bytes: number) => void,
  signal: AbortSignal,
  transferId?: string,
): Promise<void> {
  const request = <T,>(target: string, operation: "files", args: Record<string, unknown>, abort?: AbortSignal) => phoneRequest<T>(target, operation, { ...args, ...(transferId ? { _transferId: transferId } : {}) }, abort);
  if (file.size > MAX_FILE_BYTES) throw new Error("单文件上限为 100 MiB");
  const data = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const hash = await sha256(data);
  const upload = await request<{ id: string; offset: number }>(
    id,
    "files",
    { operation: "begin", name: file.name, size: file.size, sha256: hash },
    signal,
  );
  let offset = upload.offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.length)
    throw new Error("设备续传位置无效");
  progress(offset);
  while (offset < data.length) {
    signal.throwIfAborted();
    const chunk = data.subarray(offset, offset + CHUNK_BYTES);
    const result = await request<{ offset: number }>(
      id,
      "files",
      {
        operation: "chunk",
        id: upload.id,
        offset,
        data: btoa(String.fromCharCode(...chunk)),
      },
      signal,
    );
    if (result.offset !== offset + chunk.length)
      throw new Error("设备确认的传输位置不一致");
    offset = result.offset;
    progress(offset);
  }
  const result = await request<ExchangeFile>(
    id,
    "files",
    { operation: "complete", id: upload.id },
    signal,
  );
  if (result.name !== file.name || result.size !== file.size)
    throw new Error("设备未确认文件完成");
}

export async function downloadPhoneFile(
  id: string,
  file: ExchangeFile,
  progress: (bytes: number) => void,
  signal: AbortSignal,
  transferId?: string,
): Promise<Blob> {
  const request = <T,>(target: string, operation: "files", args: Record<string, unknown>, abort?: AbortSignal) => phoneRequest<T>(target, operation, { ...args, ...(transferId ? { _transferId: transferId } : {}) }, abort);
  const info = await request<ExchangeFile & { sha256: string }>(
    id,
    "files",
    { operation: "stat", name: file.name },
    signal,
  );
  if (
    !Number.isSafeInteger(info.size) ||
    info.size < 0 ||
    info.size > MAX_FILE_BYTES
  )
    throw new Error("文件大小无效或超过 100 MiB");
  const bytes = new Uint8Array(info.size);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await request<{ data: string }>(
      id,
      "files",
      { operation: "read", name: file.name, offset },
      signal,
    );
    const chunk = Uint8Array.from(atob(result.data), (char) =>
      char.charCodeAt(0),
    );
    if (
      !chunk.length ||
      chunk.length > CHUNK_BYTES ||
      offset + chunk.length > bytes.length
    )
      throw new Error("文件块不完整");
    bytes.set(chunk, offset);
    offset += chunk.length;
    progress(offset);
  }
  if ((await sha256(bytes)) !== info.sha256)
    throw new Error("文件校验失败，请重试");
  signal.throwIfAborted();
  return new Blob([bytes], { type: "application/octet-stream" });
}
