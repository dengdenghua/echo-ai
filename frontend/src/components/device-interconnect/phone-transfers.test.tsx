import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { uploadPhoneFile } from "./phone-mirror-api";
import {
  enqueuePhoneTransfer,
  pausePhoneTransfer,
  recoverPhoneTransfer,
  reconcilePhoneTransfers,
  resetPhoneTransfers,
  retryPhoneTransfer,
  usePhoneTransfers,
  type PhoneTransfer,
} from "./phone-transfers";

vi.mock("./phone-mirror-api", () => ({
  MAX_FILE_BYTES: 100 * 1024 * 1024,
  uploadPhoneFile: vi.fn(),
  downloadPhoneFile: vi.fn(),
  phoneRequest: vi.fn(async () => ({})),
}));
afterEach(() => {
  cleanup();
  resetPhoneTransfers();
  vi.clearAllMocks();
});

it("keeps a transfer alive after the window unmounts and serializes the next file", async () => {
  let complete!: () => void;
  vi.mocked(uploadPhoneFile)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const first = renderHook(() => usePhoneTransfers());
  act(() => {
    enqueuePhoneTransfer("phone", new File(["1"], "a.txt"), true);
    enqueuePhoneTransfer("phone", new File(["2"], "b.txt"), true);
  });
  expect(first.result.current.map((job) => job.state)).toEqual([
    "running",
    "queued",
  ]);
  const signal = vi.mocked(uploadPhoneFile).mock.calls[0]![3];
  first.unmount();
  expect(signal.aborted).toBe(false);
  const reopened = renderHook(() => usePhoneTransfers());
  expect(reopened.result.current).toHaveLength(2);
  await act(async () => complete());
  await waitFor(() =>
    expect(reopened.result.current.map((job) => job.state)).toEqual([
      "done",
      "done",
    ]),
  );
  expect(uploadPhoneFile).toHaveBeenCalledTimes(2);
});

it("pauses and resumes the same receipt without claiming completion on abort", async () => {
  vi.mocked(uploadPhoneFile)
    .mockImplementationOnce(async (_id, _file, progress, signal) => {
      progress(1);
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("paused"))),
      );
    })
    .mockResolvedValue(undefined);
  const { result } = renderHook(() => usePhoneTransfers());
  let id = "";
  act(() => {
    id = enqueuePhoneTransfer("phone", new File(["12"], "a.txt"), true);
  });
  act(() => pausePhoneTransfer(id));
  await waitFor(() => expect(result.current[0]?.state).toBe("cancelled"));
  act(() => retryPhoneTransfer(id));
  await waitFor(() => expect(result.current[0]?.state).toBe("done"));
  expect(vi.mocked(uploadPhoneFile).mock.calls.map((call) => call[4])).toEqual([
    id,
    id,
  ]);
});

const interrupted: PhoneTransfer = {
  id: "existing-receipt",
  deviceId: "phone",
  name: "original.txt",
  size: 2,
  bytes: 1,
  upload: true,
  state: "interrupted",
  sha256: "a".repeat(64),
};

it("uses a verified phone receipt when the browser lost the completion response", async () => {
  vi.mocked(uploadPhoneFile).mockRejectedValueOnce(
    new Error("connection lost"),
  );
  const { result } = renderHook(() => usePhoneTransfers());
  act(() =>
    recoverPhoneTransfer(interrupted, new File(["12"], "original.txt")),
  );
  await waitFor(() => expect(result.current[0]?.state).toBe("error"));
  act(() =>
    reconcilePhoneTransfers([{ ...interrupted, state: "done", bytes: 2 }]),
  );
  expect(result.current[0]?.state).toBe("done");
  expect(result.current[0]?.file).toBeUndefined();
});

it("recovers the server receipt with the original identity and hash, without duplicating it", async () => {
  vi.mocked(uploadPhoneFile).mockResolvedValue(undefined);
  const { result } = renderHook(() => usePhoneTransfers());
  const file = new File(["12"], "original.txt");
  act(() => recoverPhoneTransfer(interrupted, file));
  expect(() => recoverPhoneTransfer(interrupted, file)).toThrow("此窗口");
  await waitFor(() => expect(result.current[0]?.state).toBe("done"));
  expect(result.current[0]?.id).toBe("existing-receipt");
  expect(result.current[0]?.file).toBeUndefined();
  expect(vi.mocked(uploadPhoneFile).mock.calls[0]?.slice(4)).toEqual([
    interrupted.id,
    { attemptId: expect.any(String), expectedSha256: interrupted.sha256 },
  ]);
});

it("requires the original file and never mistakes a missing upload for a download", () => {
  expect(() => recoverPhoneTransfer(interrupted)).toThrow("原文件");
  expect(() =>
    recoverPhoneTransfer(interrupted, new File(["12"], "wrong.txt")),
  ).toThrow("原文件");
  expect(() =>
    recoverPhoneTransfer(
      { ...interrupted, state: "running" },
      new File(["12"], "original.txt"),
    ),
  ).toThrow("暂停");
  expect(uploadPhoneFile).not.toHaveBeenCalled();
});
