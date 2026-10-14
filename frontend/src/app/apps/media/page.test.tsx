import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { listNASFiles, startNASService } from "@/core/storage/api";
import { renderWithProviders } from "@/test/harness";

import MediaAppPage from "./page";

vi.mock("@/core/storage/api", () => ({
  createNASIndexJob: vi.fn().mockResolvedValue({ job_id: "job-1" }),
  listNASAlbums: vi
    .fn()
    .mockResolvedValue([
      { label: "旅行", count: 1, cover_asset_id: "photo-1" },
    ]),
  listNASFiles: vi.fn().mockResolvedValue([
    {
      asset_id: "photo-1",
      source_id: "source-1",
      name: "海边.jpg",
      path: "/照片/海边.jpg",
      extension: "jpg",
      kind: "image",
      size: 2048,
      mtime_ns: 1_735_689_600_000_000_000,
      ai_labels: ["旅行"],
    },
  ]),
  loadNASAssetURL: vi.fn().mockResolvedValue("blob:photo-1"),
  startNASService: vi.fn().mockResolvedValue({
    ok: true,
    status: "already_running",
    base_url: "http://127.0.0.1:8000",
  }),
  triggerVideoIndex: vi.fn(),
}));

describe("MediaAppPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders indexed photos and album filters as a standalone app", async () => {
    renderWithProviders(<MediaAppPage kind="image" />, {
      initialRoute: "/apps/photos",
      locale: "zh-CN",
    });

    await waitFor(() =>
      expect(screen.getByText("海边.jpg")).toBeInTheDocument(),
    );
    expect(screen.getByText("旅行 1")).toBeInTheDocument();
    expect(screen.getByText(/本机索引 · 1 项/)).toBeInTheDocument();
  });

  test("shows the unavailable state with retry when storage is not installed", async () => {
    vi.mocked(listNASFiles).mockRejectedValueOnce(
      new Error("NAS /v1/files failed: 503 - echo-storage unavailable"),
    );
    vi.mocked(startNASService).mockResolvedValueOnce({
      ok: false,
      status: "not_found",
      base_url: "/api/storage",
    });

    renderWithProviders(<MediaAppPage kind="video" />, {
      initialRoute: "/apps/media",
      locale: "zh-CN",
    });

    expect(
      await screen.findByText("本机媒体服务暂时不可用"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    // Not installed: no second listing round-trip behind the spinner.
    expect(listNASFiles).toHaveBeenCalledTimes(1);
    // An optional service being offline is state, not risk: no amber.
    const state = screen.getByRole("status");
    expect(state).toHaveTextContent("本机媒体服务暂时不可用");
    expect(state.outerHTML).not.toMatch(/warning/);
  });

  test("bounds the start probe and shows the error when it times out", async () => {
    vi.mocked(listNASFiles).mockRejectedValueOnce(
      new Error("NAS /v1/files failed: 503"),
    );
    vi.mocked(startNASService).mockRejectedValueOnce(
      new DOMException("signal timed out", "TimeoutError"),
    );

    renderWithProviders(<MediaAppPage kind="video" />, {
      initialRoute: "/apps/media",
      locale: "zh-CN",
    });

    expect(
      await screen.findByText("本机媒体服务暂时不可用"),
    ).toBeInTheDocument();
    expect(startNASService).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(listNASFiles).toHaveBeenCalledTimes(1);
  });
});
