import { afterEach, expect, it, vi } from "vitest";
import { deleteUploadedFile, type UploadedFileInfo } from "./api";

afterEach(() => vi.unstubAllGlobals());

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
