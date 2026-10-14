import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

/**
 * Current weather for a city the user picks, from Open-Meteo (free, no API
 * key). Nothing is requested until a city is set; the city name is the only
 * thing sent.
 */
export interface WeatherNow {
  city: string;
  temperature: number;
  code: number;
  isDay: boolean;
}

const CITY_KEY = "echo.browser.weather.city.v1";
export const WEATHER_CITY_EVENT = "echo:browser-weather-city";

export function readWeatherCity(): string {
  try {
    return localStorage.getItem(CITY_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeWeatherCity(city: string): void {
  try {
    if (city.trim()) localStorage.setItem(CITY_KEY, city.trim());
    else localStorage.removeItem(CITY_KEY);
  } catch {
    /* private mode: the choice lasts for this page */
  }
  window.dispatchEvent(new Event(WEATHER_CITY_EVENT));
}

/** WMO weather code → emoji and a short label. */
export function describeWeather(
  code: number,
  zh = true,
  isDay = true,
): { emoji: string; text: string } {
  if (!isDay && (code === 0 || code === 1)) {
    return { emoji: "🌙", text: zh ? (code === 0 ? "晴" : "少云") : "Clear" };
  }
  const table: [number[], string, string, string][] = [
    [[0], "☀️", "晴", "Clear"],
    [[1], "🌤️", "少云", "Mostly clear"],
    [[2], "⛅", "多云", "Partly cloudy"],
    [[3], "☁️", "阴", "Overcast"],
    [[45, 48], "🌫️", "雾", "Fog"],
    [[51, 53, 55, 56, 57], "🌦️", "毛毛雨", "Drizzle"],
    [[61, 63, 65, 66, 67], "🌧️", "雨", "Rain"],
    [[71, 73, 75, 77], "🌨️", "雪", "Snow"],
    [[80, 81, 82], "🌦️", "阵雨", "Showers"],
    [[85, 86], "🌨️", "阵雪", "Snow showers"],
    [[95, 96, 99], "⛈️", "雷雨", "Thunderstorm"],
  ];
  const hit = table.find(([codes]) => codes.includes(code));
  return hit
    ? { emoji: hit[1], text: zh ? hit[2] : hit[3] }
    : { emoji: "🌡️", text: zh ? "未知" : "Unknown" };
}

export async function fetchWeather(
  city: string,
  signal?: AbortSignal,
): Promise<WeatherNow> {
  const geo = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=${encodeURIComponent(city)}`,
    { signal },
  );
  if (!geo.ok) throw new Error(`geocoding HTTP ${geo.status}`);
  const place = (
    (await geo.json()) as {
      results?: { name: string; latitude: number; longitude: number }[];
    }
  ).results?.[0];
  if (!place) throw new Error("city not found");
  const now = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`,
    { signal },
  );
  if (!now.ok) throw new Error(`forecast HTTP ${now.status}`);
  const current = (
    (await now.json()) as {
      current?: {
        temperature_2m: number;
        weather_code: number;
        is_day?: number;
      };
    }
  ).current;
  if (!current) throw new Error("no current weather");
  return {
    city: place.name,
    temperature: current.temperature_2m,
    code: current.weather_code,
    isDay: current.is_day !== 0,
  };
}

/** The chosen city and its current weather, refreshed every 30 minutes. */
export function useWeather() {
  const [city, setCityState] = useState(readWeatherCity);
  // Other weather views (start page, desktop widget) share the city.
  useEffect(() => {
    const sync = () => setCityState(readWeatherCity());
    window.addEventListener(WEATHER_CITY_EVENT, sync);
    return () => window.removeEventListener(WEATHER_CITY_EVENT, sync);
  }, []);
  const query = useQuery({
    queryKey: ["browser-weather", city],
    queryFn: ({ signal }) => fetchWeather(city, signal),
    enabled: Boolean(city),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 1,
  });
  const setCity = useCallback((next: string) => {
    writeWeatherCity(next);
    setCityState(next.trim());
  }, []);
  return {
    city,
    setCity,
    weather: query.data,
    loading: query.isFetching,
    error: query.isError,
  };
}
