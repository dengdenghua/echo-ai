import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { uploadPhoneFile } from "./phone-mirror-api";
import { enqueuePhoneTransfer, pausePhoneTransfer, resetPhoneTransfers, retryPhoneTransfer, usePhoneTransfers } from "./phone-transfers";

vi.mock("./phone-mirror-api", () => ({
  MAX_FILE_BYTES: 100 * 1024 * 1024,
  uploadPhoneFile: vi.fn(), downloadPhoneFile: vi.fn(), phoneRequest: vi.fn(async () => ({})),
}));
afterEach(() => { cleanup(); resetPhoneTransfers(); vi.clearAllMocks(); });

it("keeps a transfer alive after the window unmounts and serializes the next file", async () => {
  let complete!: () => void;
  vi.mocked(uploadPhoneFile).mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; })).mockResolvedValue(undefined);
  const first = renderHook(() => usePhoneTransfers());
  act(() => {
    enqueuePhoneTransfer("phone", new File(["1"], "a.txt"), true);
    enqueuePhoneTransfer("phone", new File(["2"], "b.txt"), true);
  });
  expect(first.result.current.map((job) => job.state)).toEqual(["running", "queued"]);
  const signal = vi.mocked(uploadPhoneFile).mock.calls[0]![3];
  first.unmount();
  expect(signal.aborted).toBe(false);
  const reopened = renderHook(() => usePhoneTransfers());
  expect(reopened.result.current).toHaveLength(2);
  await act(async () => complete());
  await waitFor(() => expect(reopened.result.current.map((job) => job.state)).toEqual(["done", "done"]));
  expect(uploadPhoneFile).toHaveBeenCalledTimes(2);
});

it("pauses and resumes the same receipt without claiming completion on abort", async () => {
  vi.mocked(uploadPhoneFile).mockImplementationOnce(async (_id, _file, progress, signal) => {
    progress(1);
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("paused"))));
  }).mockResolvedValue(undefined);
  const { result } = renderHook(() => usePhoneTransfers());
  let id = "";
  act(() => { id = enqueuePhoneTransfer("phone", new File(["12"], "a.txt"), true); });
  act(() => pausePhoneTransfer(id));
  await waitFor(() => expect(result.current[0]?.state).toBe("cancelled"));
  act(() => retryPhoneTransfer(id));
  await waitFor(() => expect(result.current[0]?.state).toBe("done"));
  expect(vi.mocked(uploadPhoneFile).mock.calls.map((call) => call[4])).toEqual([id, id]);
});
