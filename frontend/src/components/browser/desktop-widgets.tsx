import { useEffect, useState } from "react";

import { describeWeather, useWeather } from "./weather";

/** Desktop "weather" widget: the city chosen on the start page. */
export function WeatherWidgetBody() {
  const { city, weather, loading, error } = useWeather();
  if (!city) {
    return (
      <p className="text-mini text-muted-foreground/80">
        在主页右上角「天气」里设置城市
      </p>
    );
  }
  if (weather) {
    const look = describeWeather(weather.code, true, weather.isDay);
    return (
      <div
        className="flex items-center gap-2"
        title={`${weather.city} · ${look.text}`}
      >
        <span className="text-xl" aria-hidden="true">
          {look.emoji}
        </span>
        <span className="text-lg text-muted-foreground">
          {Math.round(weather.temperature)}°C
        </span>
        <span className="truncate text-mini text-muted-foreground/80">
          {weather.city}
        </span>
      </div>
    );
  }
  return (
    <p className="text-mini text-muted-foreground/80">
      {loading ? "正在获取天气…" : error ? "暂时获取不到天气" : ""}
    </p>
  );
}

type SystemInfo = {
  cpu: number;
  memory: number;
  memoryUsed: number;
  memoryTotal: number;
};

/** Desktop "system" widget: CPU and memory from the desktop app. */
export function SystemWidgetBody() {
  const getSystemInfo = window.echo?.desktop?.getSystemInfo;
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => {
    if (!getSystemInfo) return;
    let cancelled = false;
    const sample = async () => {
      const result = await getSystemInfo().catch(() => null);
      if (cancelled || !result?.ok || !result.cpu || !result.memory) return;
      setInfo({
        cpu: result.cpu.usage,
        memory: result.memory.percent,
        memoryUsed: result.memory.used,
        memoryTotal: result.memory.total,
      });
    };
    void sample();
    const timer = window.setInterval(() => void sample(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getSystemInfo]);

  if (!getSystemInfo) {
    return (
      <p className="text-mini text-muted-foreground/80">
        桌面版可显示 CPU 与内存占用
      </p>
    );
  }
  if (!info)
    return <p className="text-mini text-muted-foreground/80">读取中…</p>;
  const bar = (
    label: string,
    percent: number,
    detail: string,
    tone: string,
  ) => (
    <div className="space-y-0.5" title={detail}>
      <div className="flex justify-between text-mini text-muted-foreground/80">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted-foreground/12">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {bar("CPU", info.cpu, `CPU ${info.cpu}%`, "bg-primary")}
      {bar(
        "内存",
        info.memory,
        `${info.memoryUsed} / ${info.memoryTotal} GB`,
        "bg-accent-foreground/60",
      )}
    </div>
  );
}
