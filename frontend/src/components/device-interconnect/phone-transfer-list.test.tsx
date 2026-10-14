import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PhoneTransferList } from "./phone-transfer-list";
import { phoneRequest, uploadPhoneFile } from "./phone-mirror-api";
import { resetPhoneTransfers } from "./phone-transfers";

vi.mock("./phone-mirror-api", () => ({
  MAX_FILE_BYTES: 100 * 1024 * 1024,
  uploadPhoneFile: vi.fn(),
  downloadPhoneFile: vi.fn(),
  phoneRequest: vi.fn(),
}));
afterEach(() => {
  cleanup();
  resetPhoneTransfers();
  vi.clearAllMocks();
});

it("shows restarted receipts and lets a new window select the original file to continue", async () => {
  vi.mocked(phoneRequest).mockResolvedValue({
    jobs: [
      {
        id: "from-os",
        deviceId: "phone",
        name: "file.txt",
        size: 2,
        bytes: 1,
        upload: true,
        state: "interrupted",
        sha256: "a".repeat(64),
        updatedAt: Date.now() / 1000,
      },
    ],
  });
  vi.mocked(uploadPhoneFile).mockResolvedValue(undefined);
  render(<PhoneTransferList />);
  const picker = await screen.findByLabelText("选择原文件继续传输：file.txt");
  expect(screen.getByText(/传输已中断，可恢复/)).toBeInTheDocument();
  fireEvent.change(picker, {
    target: { files: [new File(["12"], "wrong.txt")] },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("原文件");
  expect(uploadPhoneFile).not.toHaveBeenCalled();
  fireEvent.change(picker, {
    target: { files: [new File(["12"], "file.txt")] },
  });
  await waitFor(() => expect(screen.getByText(/已送达/)).toBeInTheDocument());
  expect(vi.mocked(uploadPhoneFile).mock.calls[0]?.[4]).toBe("from-os");
  expect(
    screen.queryByLabelText("选择原文件继续传输：file.txt"),
  ).not.toBeInTheDocument();
});
