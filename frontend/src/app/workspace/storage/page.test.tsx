import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type * as StorageApi from "@/core/storage/api";
import {
  NASRequestError,
  getNASManifest,
  listNASDirectory,
  startNASService,
} from "@/core/storage/api";
import { renderWithProviders } from "@/test/harness";
import StoragePage from "./page";

vi.mock("@/core/storage/api", async (importOriginal) => ({
  ...(await importOriginal<typeof StorageApi>()),
  getNASManifest: vi.fn(),
  getNASPolicy: vi.fn().mockResolvedValue({ mode: "privacy" }),
  listNASSources: vi.fn().mockResolvedValue([]),
  listNASDirectory: vi.fn().mockRejectedValue(new Error("HTTP 503")),
  startNASService: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getNASManifest)
    .mockReset()
    .mockRejectedValue(new Error("HTTP 503"));
  vi.mocked(startNASService).mockReset().mockResolvedValue({
    ok: false,
    status: "not_found",
    base_url: "/api/storage",
    auth_token: null,
  });
});

it("explains a missing storage service without polling an uninstalled process", async () => {
  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/storage?library=computer",
  });
  expect(
    await screen.findByText(/还没有安装本地知识库服务（echo-storage）/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/ECHO_STORAGE_CMD/)).toBeNull();
  expect(startNASService).toHaveBeenCalledOnce();
  expect(getNASManifest).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "扫描", exact: true }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "效率", exact: true }),
  ).toBeDisabled();
});

it("explains an unresponsive storage service instead of its raw 503 detail", async () => {
  const unavailable = new NASRequestError(
    "/v1/manifest",
    503,
    '{"detail":"echo-storage unavailable"}',
  );
  vi.mocked(getNASManifest).mockRejectedValue(unavailable);
  vi.mocked(listNASDirectory).mockRejectedValue(
    new NASRequestError("/v1/fs", 503, "echo-storage unavailable"),
  );
  // The start probe is still pending: only the first read has failed.
  vi.mocked(startNASService).mockReturnValue(new Promise(() => {}));

  renderWithProviders(<StoragePage />, {
    locale: "zh-CN",
    initialRoute: "/workspace/storage?library=computer",
  });

  expect(
    await screen.findByText(/本地知识库服务暂时没有响应/),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("本地知识库服务没有响应，目录还没读取。"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/echo-storage unavailable/)).toBeNull();
});
