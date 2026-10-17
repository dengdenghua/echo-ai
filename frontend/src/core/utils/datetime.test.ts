import { afterEach, describe, expect, test, vi } from "vitest";

import {
  formatCompactRelativeTimestamp,
  formatRelativeTimestamp,
} from "./datetime";

describe("compact relative timestamps", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("uses short month-day labels for old Chinese sidebar dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 9, 0, 0));

    const oldDate = new Date(2026, 5, 30, 9, 0, 0);

    expect(formatRelativeTimestamp(oldDate, "zh-CN")).toBe("2026年06月30日");
    expect(formatCompactRelativeTimestamp(oldDate, "zh-CN")).toBe("6/30");
  });

  test("uses compact recent relative labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 9, 0, 0));

    const recentDate = new Date(2026, 6, 9, 8, 42, 0);

    expect(formatCompactRelativeTimestamp(recentDate, "zh-CN")).toBe("18 分钟");
    expect(formatCompactRelativeTimestamp(recentDate, "en-US")).toBe("18m");
    expect(formatCompactRelativeTimestamp(recentDate, "ja-JP")).toBe("18分");
    expect(formatCompactRelativeTimestamp(recentDate, "ko-KR")).toBe("18분");
  });

  test("names hours in the reader's language too", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 9, 0, 0));

    const earlier = new Date(2026, 6, 9, 4, 30, 0);

    expect(formatCompactRelativeTimestamp(earlier, "zh-CN")).toBe("4 小时");
    expect(formatCompactRelativeTimestamp(earlier, "en-US")).toBe("4h");
    expect(formatCompactRelativeTimestamp(earlier, "ja-JP")).toBe("4時間");
    expect(formatCompactRelativeTimestamp(earlier, "ko-KR")).toBe("4시간");
  });

  test("keeps the first minute as just-now instead of 0m", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 9, 0, 45));

    const fortyFiveSecondsAgo = new Date(2026, 6, 9, 9, 0, 0);

    expect(formatCompactRelativeTimestamp(fortyFiveSecondsAgo, "zh-CN")).toBe(
      "刚刚",
    );
    expect(formatCompactRelativeTimestamp(fortyFiveSecondsAgo, "en-US")).toBe(
      "now",
    );
    expect(formatRelativeTimestamp(fortyFiveSecondsAgo, "zh-CN")).toBe("刚刚");
  });

  test("does not throw for an unfinished thread timestamp", () => {
    expect(formatCompactRelativeTimestamp("", "zh-CN")).toBe("");
    expect(formatRelativeTimestamp("not-a-date", "zh-CN")).toBe("");
  });
});
