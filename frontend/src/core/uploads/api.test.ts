import { afterEach, expect, it, vi } from "vitest";
import {
  deleteUploadedFile,
  uploadFilesWithProgress,
  type UploadedFileInfo,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("turns a stalled upload into a retryable timeout and releases its abort listener", async () => {
  vi.useFakeTimers();
  class StalledXHR {
    timeout = 0;
    upload = {};
    ontimeout?: () => void;
    open() {}
    setRequestHeader() {}
    send() {
      if (this.timeout > 0) setTimeout(() => this.ontimeout?.(), this.timeout);
    }
    abort() {}
  }
  vi.stubGlobal("XMLHttpRequest", StalledXHR);
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, "removeEventListener");
  const outcome = uploadFilesWithProgress(
    "thread-a",
    [new File(["x"], "draft.txt")],
    { signal: controller.signal },
  ).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(await outcome).toEqual(new Error("Upload timed out"));
  expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("does not open a network request for an already cancelled upload", async () => {
  const XHR = vi.fn();
  vi.stubGlobal("XMLHttpRequest", XHR);
  const controller = new AbortController();
  controller.abort();
  await expect(
    uploadFilesWithProgress("thread-a", [], { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(XHR).not.toHaveBeenCalled();
});

it("deletes the selected instance when uploaded display names repeat", async () => {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, message: "Deleted same.txt" }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  const file: UploadedFileInfo = {
    filename: "same.txt",
    size: 1,
    path: "E:/uploads/thread-1/upload-second/same.txt",
    virtual_path: "E:/uploads/thread-1/upload-second/same.txt",
    artifact_url: "/api/threads/thread-1/artifacts/upload-second/same.txt",
    modified: 1,
  };
  await deleteUploadedFile("thread-1", file);
  const requestedUrl = String(fetchSpy.mock.calls[0]?.[0]);
  expect(requestedUrl).toContain(encodeURIComponent(file.path));
  expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
});

it("keeps legacy filename deletion callers working", async () => {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, message: "Deleted old.txt" }),
  });
  vi.stubGlobal("fetch", fetchSpy);
  await deleteUploadedFile("thread-1", "old.txt");
  expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/uploads/old.txt");
});
