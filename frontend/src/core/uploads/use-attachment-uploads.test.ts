import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadedFileInfo } from "./api";
import type * as UploadsApiModule from "./api";
import { useAttachmentUploads } from "./use-attachment-uploads";

const uploadFilesWithProgressMock = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<UploadsApiModule>();
  return {
    ...actual,
    uploadFilesWithProgress: (...args: unknown[]) =>
      uploadFilesWithProgressMock(...args),
  };
});

function uploaded(filename: string, marker: string): UploadedFileInfo {
  return {
    filename,
    size: marker.length,
    path: `/artifacts/${marker}/${filename}`,
    virtual_path: `uploads/${marker}/${filename}`,
    artifact_url: `https://example.test/${marker}/${filename}`,
    content_type: "image/png",
  };
}

function deferredUpload() {
  let resolve!: (value: { files: UploadedFileInfo[] }) => void;
  let progress: ((percent: number) => void) | undefined;
  const promise = new Promise<{ files: UploadedFileInfo[] }>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve,
    bindProgress: (callback: ((percent: number) => void) | undefined) => {
      progress = callback;
    },
    progress: (percent: number) => progress?.(percent),
  };
}

describe("useAttachmentUploads thread isolation", () => {
  beforeEach(() => {
    uploadFilesWithProgressMock.mockReset();
  });

  it.each(["remove", "reset", "switch", "unmount"])(
    "cancels a pending network upload on %s instead of just hiding its progress",
    (action) => {
      uploadFilesWithProgressMock.mockImplementation(
        () => new Promise(() => {}),
      );
      const { result, rerender, unmount } = renderHook(
        ({ threadId }) => useAttachmentUploads(threadId),
        { initialProps: { threadId: "thread-a" } },
      );
      act(() =>
        result.current.start([
          { key: "cancel-me", file: new File(["x"], "draft.txt") },
        ]),
      );
      const signal = uploadFilesWithProgressMock.mock.calls[0]?.[2]
        ?.signal as AbortSignal;
      expect(signal?.aborted).toBe(false);
      if (action === "remove") act(() => result.current.remove("cancel-me"));
      if (action === "reset") act(() => result.current.reset());
      if (action === "switch") rerender({ threadId: "thread-b" });
      if (action === "unmount") unmount();
      expect(signal.aborted).toBe(true);
    },
  );

  it("cancels a superseded attempt without aborting its replacement", async () => {
    const first = deferredUpload();
    const second = deferredUpload();
    uploadFilesWithProgressMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAttachmentUploads("thread-a"));
    act(() =>
      result.current.start([
        { key: "same", file: new File(["x"], "draft.txt") },
      ]),
    );
    const firstSignal = uploadFilesWithProgressMock.mock.calls[0]?.[2]
      ?.signal as AbortSignal;
    act(() => result.current.retry("same"));
    const secondSignal = uploadFilesWithProgressMock.mock.calls[1]?.[2]
      ?.signal as AbortSignal;
    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    await act(async () => {
      first.resolve({ files: [uploaded("draft.txt", "old")] });
      await first.promise;
    });
    expect(result.current.uploads.get("same")?.status).toBe("uploading");
    act(() => result.current.remove("same"));
    expect(secondSignal.aborted).toBe(true);
  });

  it("clears the ledger and ignores an old response for the same attachment key", async () => {
    const oldUpload = deferredUpload();
    const newUpload = deferredUpload();
    uploadFilesWithProgressMock
      .mockImplementationOnce(
        (
          _threadId: string,
          _files: File[],
          options?: { onProgress?: (percent: number) => void },
        ) => {
          oldUpload.bindProgress(options?.onProgress);
          return oldUpload.promise;
        },
      )
      .mockImplementationOnce(
        (
          _threadId: string,
          _files: File[],
          options?: { onProgress?: (percent: number) => void },
        ) => {
          newUpload.bindProgress(options?.onProgress);
          return newUpload.promise;
        },
      );

    const { result, rerender } = renderHook(
      ({ threadId }) => useAttachmentUploads(threadId),
      { initialProps: { threadId: "thread-a" } },
    );
    const oldFile = new File(["old"], "same.png", { type: "image/png" });
    const newFile = new File(["new"], "same.png", { type: "image/png" });

    act(() => result.current.start([{ key: "same-key", file: oldFile }]));
    expect(result.current.isUploading).toBe(true);

    rerender({ threadId: "thread-b" });
    expect(result.current.uploads.size).toBe(0);
    expect(result.current.isUploading).toBe(false);

    act(() => result.current.start([{ key: "same-key", file: newFile }]));
    expect(uploadFilesWithProgressMock).toHaveBeenNthCalledWith(
      2,
      "thread-b",
      [newFile],
      expect.any(Object),
    );

    act(() => oldUpload.progress(91));
    expect(result.current.uploads.get("same-key")?.progress).toBe(0);

    await act(async () => {
      oldUpload.resolve({ files: [uploaded("same.png", "old-thread")] });
      await oldUpload.promise;
    });
    expect(result.current.uploads.get("same-key")).toMatchObject({
      file: newFile,
      status: "uploading",
      progress: 0,
    });

    await act(async () => {
      newUpload.resolve({ files: [uploaded("same.png", "new-thread")] });
      await newUpload.promise;
    });
    await waitFor(() =>
      expect(result.current.uploads.get("same-key")).toMatchObject({
        file: newFile,
        status: "done",
        progress: 100,
        uploaded: { path: "/artifacts/new-thread/same.png" },
      }),
    );
  });
});
