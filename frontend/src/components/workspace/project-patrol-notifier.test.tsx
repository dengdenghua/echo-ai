import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "@/core/i18n";
import { renderWithProviders } from "@/test/harness";

import {
  PROJECT_PATROL_POLL_MS,
  ProjectPatrolNotifier,
} from "./project-patrol-notifier";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  show: vi.fn(
    (
      _request: { title: string; href?: string },
      _options?: { onClick?: () => void },
    ) => true,
  ),
  auth: { user: undefined as object | undefined },
}));
vi.mock("@/core/api/request", () => ({ apiGet: mocks.get }));
vi.mock("@/core/notification/system-notify", () => ({
  showSystemNotification: mocks.show,
}));
vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => mocks.auth,
}));

const digest = {
  day: "2026-10-11",
  digest_id: "owner-a-day-one",
  notices: [{ id: "notice-a", project_id: "P /one", name: "Project" }],
};

describe("project daily patrol notifications", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.get.mockReset().mockResolvedValue(digest);
    mocks.show.mockReset().mockReturnValue(true);
    mocks.auth.user = undefined;
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["zh-CN", "1 个项目需要你处理"],
    ["en-US", "1 project needs your attention"],
    ["ja-JP", "1 件のプロジェクトに対応が必要です"],
    ["ko-KR", "1개 프로젝트에 확인이 필요합니다"],
  ])(
    "notifies in %s and restores daily deduplication after remount",
    async (locale, title) => {
      const first = renderWithProviders(<ProjectPatrolNotifier />, {
        locale: locale as Locale,
      });
      await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
      expect(mocks.show.mock.calls[0][0]).toMatchObject({
        title,
        href: "/workspace/projects?project=P%20%2Fone",
      });
      first.unmount();
      renderWithProviders(<ProjectPatrolNotifier />);
      await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
      expect(mocks.show).toHaveBeenCalledOnce();
    },
  );

  it.each([{ enabled: false }, { enabled: true, paused: false }])(
    "respects notification preferences %j",
    async (notification) => {
      localStorage.setItem(
        "echo.local-settings",
        JSON.stringify({ notification }),
      );
      renderWithProviders(<ProjectPatrolNotifier />);
      await act(async () => {});
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.show).not.toHaveBeenCalled();
    },
  );

  it("stays quiet for healthy projects and while only-unfocused mode is focused", async () => {
    localStorage.setItem(
      "echo.local-settings",
      JSON.stringify({
        notification: { enabled: true, only_when_unfocused: true },
      }),
    );
    vi.mocked(document.hasFocus).mockReturnValue(true);
    const view = renderWithProviders(<ProjectPatrolNotifier />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
    expect(mocks.show).not.toHaveBeenCalled();
    view.unmount();
    mocks.get.mockResolvedValue({ ...digest, notices: [] });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    renderWithProviders(<ProjectPatrolNotifier />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it("discards the previous account's late response", async () => {
    let resolveOld: (value: typeof digest) => void = () => {};
    mocks.auth.user = { user_id: "alice" };
    mocks.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const view = renderWithProviders(<ProjectPatrolNotifier />);
    mocks.auth.user = { user_id: "bob" };
    mocks.get.mockResolvedValueOnce({
      ...digest,
      digest_id: "owner-b-day-one",
      notices: [],
    });
    view.rerender(<ProjectPatrolNotifier />);
    await act(async () => {
      resolveOld(digest);
    });
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it("retries unavailable notification delivery and stops polling after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.show.mockReturnValueOnce(false);
    const view = renderWithProviders(<ProjectPatrolNotifier />);
    await waitFor(() => expect(mocks.show).toHaveBeenCalledOnce());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_PATROL_POLL_MS);
    });
    expect(mocks.show).toHaveBeenCalledTimes(2);
    view.unmount();
    const requests = mocks.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_PATROL_POLL_MS);
    });
    expect(mocks.get).toHaveBeenCalledTimes(requests);
  });
});
