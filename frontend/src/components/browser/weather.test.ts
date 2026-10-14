import { afterEach, describe, expect, it, vi } from "vitest";

import { describeWeather, fetchWeather } from "./weather";

afterEach(() => vi.unstubAllGlobals());

describe("weather", () => {
  it("maps WMO codes, with a moon for clear nights", () => {
    expect(describeWeather(0)).toEqual({ emoji: "☀️", text: "晴" });
    expect(describeWeather(0, true, false)).toEqual({ emoji: "🌙", text: "晴" });
    expect(describeWeather(63).text).toBe("雨");
    expect(describeWeather(1234).text).toBe("未知");
  });

  it("geocodes the city, then reads the current conditions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ name: "杭州", latitude: 30.29, longitude: 120.16 }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            current: { temperature_2m: 19.4, weather_code: 2, is_day: 1 },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWeather("杭州")).resolves.toEqual({
      city: "杭州",
      temperature: 19.4,
      code: 2,
      isDay: true,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      `name=${encodeURIComponent("杭州")}`,
    );
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      "latitude=30.29&longitude=120.16",
    );
  });

  it("reports an unknown city", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}))),
    );
    await expect(fetchWeather("nowhere")).rejects.toThrow("city not found");
  });
});
