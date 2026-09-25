import { useEffect, useRef, useState } from "react";
import { phoneRequest } from "./phone-mirror-api";

export function DesktopCast({
  deviceId,
  online,
}: {
  deviceId: string;
  online: boolean;
}) {
  const [state, setState] = useState<"idle" | "starting" | "live">("idle");
  const [error, setError] = useState("");
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), [deviceId]);
  useEffect(() => {
    if (!online) stopRef.current();
  }, [online]);

  const start = async () => {
    if (state !== "idle" || !online) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("此浏览器不支持屏幕共享，请使用 HTTPS 或本机桌面浏览器");
      return;
    }
    setState("starting");
    setError("");
    let stream: MediaStream | undefined;
    let sessionId = "";
    let timer: number | undefined;
    let stopped = false;
    const abort = new AbortController();
    const stop = () => {
      if (stopped) return;
      stopped = true;
      abort.abort();
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (sessionId)
        void phoneRequest(deviceId, "cast", {
          operation: "stop",
          sessionId,
        }).catch(() => {});
      setState("idle");
    };
    stopRef.current = stop;
    try {
      // Must run in the click gesture. The browser's source picker owns screen consent.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, frameRate: { ideal: 3, max: 5 } },
        audio: false,
      });
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream
        .getVideoTracks()[0]
        ?.addEventListener("ended", stop, { once: true });
      const result = await phoneRequest<{ sessionId: string }>(
        deviceId,
        "cast",
        { operation: "start" },
        abort.signal,
      );
      sessionId = result.sessionId;
      if (!sessionId) throw new Error("设备未确认投屏会话");
      if (stopped) {
        void phoneRequest(deviceId, "cast", {
          operation: "stop",
          sessionId,
        }).catch(() => {});
        return;
      }
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法读取共享画面");
      const next = async () => {
        if (stopped) return;
        try {
          if (!video.videoWidth || !video.videoHeight)
            throw new Error("共享来源尚无画面");
          const ratio = Math.min(
            1,
            1280 / Math.max(video.videoWidth, video.videoHeight),
          );
          canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
          canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const jpeg = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
          const delivered = await phoneRequest<{ delivered: boolean }>(
            deviceId,
            "cast",
            { operation: "frame", sessionId, jpeg },
            abort.signal,
          );
          if (!delivered.delivered) throw new Error("画面未送达设备连接");
          if (!stopped) {
            setState("live");
            timer = window.setTimeout(() => void next(), 350);
          }
        } catch (failure) {
          if (!stopped) setError((failure as Error).message);
          stop();
        }
      };
      void next();
    } catch (failure) {
      if (!stopped) setError((failure as Error).message);
      stop();
    }
  };
  return (
    <section
      aria-label="电脑投到手机"
      className="border-t border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600"
    >
      <div className="flex items-center justify-between gap-2">
        <span>
          {state === "live"
            ? "正在发送电脑画面"
            : state === "starting"
              ? "正在建立投屏…"
              : "电脑 → 此手机"}
        </span>
        {state === "idle" ? (
          <button
            disabled={!online}
            onClick={() => void start()}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            共享电脑画面
          </button>
        ) : (
          <button
            onClick={() => stopRef.current()}
            className="rounded border px-2 py-1"
          >
            停止共享
          </button>
        )}
      </div>
      {state === "idle" && (
        <p className="mt-1">
          先在手机打开“电脑远程桌面”，再选择电脑窗口。此方式仅观看。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
