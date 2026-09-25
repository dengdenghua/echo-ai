import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Circle,
  FileUp,
  Files,
  MonitorSmartphone,
  Pause,
  Play,
  RefreshCw,
  Smartphone,
  Square,
  X,
} from "lucide-react";
import { refreshDeviceDirectory, useDeviceDirectory } from "./device-directory";
import { enqueuePhoneTransfer, usePhoneTransfers } from "./phone-transfers";
import { PhoneTransferList } from "./phone-transfer-list";
import { DesktopCast } from "./desktop-cast";
import { PhoneKeyboard } from "./phone-keyboard";
import {
  phoneRequest,
  type ExchangeFile,
  type PhoneFrame,
} from "./phone-mirror-api";

type Props = {
  deviceId?: string;
  deviceName?: string;
  onOpenWorkbench?: (route: string, options?: { title?: string }) => void;
  onClose?: () => void;
};
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
const navigationButton = `${button.replace("gap-2", "gap-1").replace("px-3", "px-2")} whitespace-nowrap`;
const sizeLabel = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / 1024 / 1024).toFixed(1)} MiB`;

export function PhoneMirrorApp({ deviceId, deviceName, onClose }: Props) {
  const directory = useDeviceDirectory();
  const devices =
    directory.status?.devices.filter((item) => item.platform === "android") ||
    [];
  const deviceError = directory.error;
  const transfers = usePhoneTransfers();
  const [selected, setSelected] = useState(deviceId || "");
  const [frameError, setFrameError] = useState("");
  const [error, setError] = useState("");
  const [frame, setFrame] = useState<PhoneFrame | null>(null);
  const [paused, setPaused] = useState(false);
  const [latency, setLatency] = useState(0);
  const [filesOpen, setFilesOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const controlQueue = useRef<
    {
      args: Record<string, unknown>;
      target: string;
      version: number;
      aspect: number;
    }[]
  >([]);
  const [controlling, setControlling] = useState(false);
  const [files, setFiles] = useState<ExchangeFile[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [fileError, setFileError] = useState("");
  const generation = useRef(0);
  const activeDevice = useRef(selected);
  activeDevice.current = selected;
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);
  const busyControl = useRef(false);
  const fileRequest = useRef(false);
  const device = devices.find((item) => item.id === selected);
  const online = !!device?.online;
  const running = transfers.some(
    (job) =>
      job.deviceId === selected && ["running", "queued"].includes(job.state),
  );

  const refreshDevices = refreshDeviceDirectory;
  useEffect(() => {
    if (!selected && directory.status)
      setSelected(
        deviceId ||
          directory.status.devices.find(
            (item) => item.platform === "android" && item.online,
          )?.id ||
          "",
      );
  }, [selected, deviceId, directory.status]);

  useEffect(() => {
    const version = ++generation.current;
    setFrame(null);
    setFiles([]);
    setTotalFiles(0);
    setError("");
    setPaused(false);
    setFrameError("");
    controlQueue.current = [];
    return () => {
      generation.current = version + 1;
      controlQueue.current = [];
    };
  }, [selected]);

  useEffect(() => {
    setFrame(null);
    if (!selected || !online || paused) return;
    setFrameError("");
    const abort = new AbortController();
    let timer: number;
    let failures = 0;
    const next = async () => {
      const start = performance.now();
      let wait = 400;
      try {
        const result = await phoneRequest<PhoneFrame>(
          selected,
          "frame",
          {},
          abort.signal,
        );
        if (!result.jpeg || result.width <= 0 || result.height <= 0)
          throw new Error("手机未返回有效画面");
        if (!abort.signal.aborted) {
          failures = 0;
          setFrame(result);
          setFrameError("");
          setLatency(Math.round(performance.now() - start));
        }
      } catch (failure) {
        if (!abort.signal.aborted) {
          setFrame(null);
          setFrameError((failure as Error).message);
          failures += 1;
          if (failures >= 3) setPaused(true);
        }
        wait = 2500;
      }
      if (!abort.signal.aborted)
        timer = window.setTimeout(() => void next(), wait);
    };
    void next();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [selected, online, paused]);

  const refreshFiles = useCallback(
    async (offset = 0) => {
      if (!selected || !online || fileRequest.current) return;
      const target = selected;
      const version = generation.current;
      fileRequest.current = true;
      try {
        const result = await phoneRequest<{
          files: ExchangeFile[];
          total: number;
        }>(target, "files", { operation: "list", offset });
        if (!Array.isArray(result.files)) throw new Error("手机未返回文件列表");
        if (activeDevice.current !== target || generation.current !== version)
          return;
        setFiles((previous) =>
          offset ? [...previous, ...result.files] : result.files,
        );
        setTotalFiles(result.total);
        setFileError("");
      } catch (failure) {
        if (activeDevice.current === target && generation.current === version)
          setFileError((failure as Error).message);
      } finally {
        fileRequest.current = false;
      }
    },
    [selected, online],
  );
  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);
  useEffect(() => {
    // Serial requests; keep a paginated list stable while browsing older entries.
    const timer = window.setInterval(() => {
      if (!document.hidden && files.length <= 50 && !running)
        void refreshFiles();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refreshFiles, files.length, running]);

  const control = async (args: Record<string, unknown>) => {
    if (!frame || !online || paused) return;
    if (
      controlQueue.current.length >= 128 ||
      (typeof args.text === "string" && args.text.length > 8000)
    ) {
      setError("输入过快或文字过长，请等手机处理后再试");
      return;
    }
    const tail = controlQueue.current.at(-1);
    if (
      args.action === "edit" &&
      args.command === "insert" &&
      tail?.target === selected &&
      tail.version === generation.current &&
      tail.args.action === "edit" &&
      tail.args.command === "insert" &&
      typeof args.text === "string" &&
      typeof tail.args.text === "string" &&
      tail.args.text.length + args.text.length <= 8000
    ) {
      tail.args.text += args.text;
    } else {
      controlQueue.current.push({
        args,
        target: selected,
        version: generation.current,
        aspect: frame.width / frame.height,
      });
    }
    if (busyControl.current) return;
    busyControl.current = true;
    setControlling(true);
    setError("");
    try {
      while (controlQueue.current.length) {
        const item = controlQueue.current.shift()!;
        if (
          item.version !== generation.current ||
          item.target !== activeDevice.current
        )
          continue;
        try {
          const result = await phoneRequest<{ applied: boolean }>(
            item.target,
            "control",
            { ...item.args, aspect: item.aspect },
          );
          if (result.applied !== true) throw new Error("手机未确认操作");
        } catch (failure) {
          if (item.version === generation.current) {
            controlQueue.current = [];
            setError(
              `${(failure as Error).message}。后续输入已停止，请确认手机内容后继续。`,
            );
          }
        }
      }
    } finally {
      busyControl.current = false;
      setControlling(false);
    }
  };

  const startTransfer = (file: File | ExchangeFile, upload: boolean) => {
    if (!selected || !online) {
      setError("手机离线，请连接后再传文件");
      return;
    }
    try {
      enqueuePhoneTransfer(selected, file, upload);
      setFilesOpen(true);
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <div
      data-testid="phone-mirror-container"
      style={{ containerType: "size" }}
      className="flex h-full min-h-0 flex-col bg-[#f5f7fb] text-slate-800"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files;
        for (const file of dropped) startTransfer(file, true);
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/90 px-3 py-2">
        <span className="rounded-2xl bg-blue-600 p-2.5 text-white">
          <MonitorSmartphone size={20} />
        </span>
        <div className="min-w-[120px] flex-1">
          <h1 className="text-sm font-semibold">
            手机协同
            {selected && (
              <span
                className="ml-2 font-mono text-[10px] font-normal text-slate-400"
                title={selected}
              >
                {selected.slice(-6)}
              </span>
            )}
          </h1>
          <p
            className="mt-0.5 max-w-48 truncate text-xs text-slate-500"
            title={selected}
          >
            {device
              ? [device.brand, device.model].filter(Boolean).join(" ") ||
                device.id
              : "连接你的手机"}
          </p>
        </div>
        {!deviceId && (
          <select
            aria-label="选择手机"
            value={selected}
            disabled={running || !!deviceId}
            onChange={(event) => setSelected(event.target.value)}
            className="order-last w-full rounded-xl border border-slate-200 bg-white p-2 text-xs"
          >
            {!devices.length && (
              <option value={selected}>
                {deviceName || "尚无已配对 Android 手机"}
              </option>
            )}
            {devices.map((item) => (
              <option key={item.id} value={item.id}>
                {[item.brand, item.model].filter(Boolean).join(" ") || item.id}{" "}
                · {item.online ? "在线" : "离线"} · {item.id}
              </option>
            ))}
          </select>
        )}
        <button
          className={button}
          aria-expanded={filesOpen}
          aria-controls="phone-files"
          onClick={() => setFilesOpen(!filesOpen)}
        >
          <Files size={14} />
          文件{running ? " · 传输中" : totalFiles ? ` · ${totalFiles}` : ""}
        </button>
        <button
          className={button}
          aria-label="刷新设备"
          onClick={() => void refreshDevices()}
        >
          <RefreshCw size={14} />
        </button>
        {onClose && (
          <button
            className={button}
            aria-label="关闭手机协同"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        )}
      </header>
      {deviceError && (
        <p
          role="alert"
          className="bg-amber-50 px-5 py-2 text-xs text-amber-800"
        >
          {deviceError}
        </p>
      )}
      {dragging && (
        <div className="bg-blue-50 px-4 py-2 text-center text-xs text-blue-700">
          松开发送到此手机的 Echo 文件收发目录
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col items-center gap-2 overflow-auto p-3">
          <div className="flex w-full items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <i
                className={`size-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              {online ? "设备在线" : "等待设备连接"}
            </span>
            <span>{frame ? `画面请求 ${latency} ms` : ""}</span>
          </div>
          <div className="flex shrink-0 flex-1 items-center justify-center">
            {frame && !paused ? (
              <img
                alt="手机实时画面"
                draggable={false}
                src={`data:image/jpeg;base64,${frame.jpeg}`}
                style={{
                  maxHeight: "max(180px, calc(100cqh - 200px))",
                }}
                className="max-w-full touch-none select-none rounded-2xl border-[6px] border-slate-900 bg-slate-950 shadow-xl"
                onPointerDown={(event) => {
                  if (event.button !== 0 || controlling) return;
                  event.preventDefault();
                  keyboard.current?.focus({ preventScroll: true });
                  const rect = event.currentTarget.getBoundingClientRect();
                  pointer.current = {
                    x: Math.max(
                      0,
                      Math.min(
                        1,
                        (event.clientX - rect.left - 6) / (rect.width - 12),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1,
                        (event.clientY - rect.top - 6) / (rect.height - 12),
                      ),
                    ),
                    at: performance.now(),
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                  pointer.current = null;
                }}
                onPointerUp={(event) => {
                  const start = pointer.current;
                  pointer.current = null;
                  if (!start) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = Math.max(
                    0,
                    Math.min(
                      1,
                      (event.clientX - rect.left - 6) / (rect.width - 12),
                    ),
                  );
                  const y = Math.max(
                    0,
                    Math.min(
                      1,
                      (event.clientY - rect.top - 6) / (rect.height - 12),
                    ),
                  );
                  const duration = Math.round(performance.now() - start.at);
                  void control(
                    Math.hypot(x - start.x, y - start.y) > 0.015
                      ? {
                          action: "swipe",
                          x: start.x,
                          y: start.y,
                          end_x: x,
                          end_y: y,
                          duration,
                        }
                      : { action: "tap", x, y, duration },
                  );
                }}
              />
            ) : (
              <div className="max-w-sm rounded-3xl border border-dashed border-slate-300 bg-white/60 px-8 py-14 text-center">
                <Smartphone className="mx-auto mb-4 text-slate-400" size={36} />
                <p className="text-sm font-medium">
                  {frameError
                    ? "暂时无法显示画面"
                    : paused
                      ? "画面已暂停"
                      : !selected
                        ? "先在设备连接中配对手机"
                        : !online
                          ? "手机当前离线"
                          : frameError
                            ? "暂时无法显示画面"
                            : "正在获取手机画面…"}
                </p>
                <p className="mt-3 text-xs leading-6 text-slate-500">
                  {frameError ||
                    "真机、Android 模拟器和云手机使用同一入口。连接后，在手机授权屏幕采集与无障碍操作。"}
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {(
              [
                { action: "back", name: "返回", icon: ArrowLeft },
                { action: "home", name: "主页", icon: Circle },
                { action: "recents", name: "最近任务", icon: Square },
              ] as const
            ).map(({ action, name, icon: Icon }) => (
              <button
                key={action}
                className={navigationButton}
                disabled={!frame || paused || controlling}
                onClick={() => void control({ action })}
              >
                <Icon size={14} />
                {name}
              </button>
            ))}
            <button
              className={navigationButton}
              disabled={!online}
              onClick={() => {
                controlQueue.current = [];
                setPaused(!paused);
              }}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "继续画面" : "暂停画面"}
            </button>
          </div>
          <PhoneKeyboard
            key={selected}
            ref={keyboard}
            disabled={!frame || paused || !online}
            onEdit={(command, text) =>
              void control(
                command === "back"
                  ? { action: "back" }
                  : {
                      action: "edit",
                      command,
                      ...(text !== undefined ? { text } : {}),
                    },
              )
            }
          />
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            点击操作 · 拖动画面滑动 · 画面随手机方向变化
          </p>
        </section>
        {filesOpen && (
          <aside
            id="phone-files"
            aria-label="文件收发"
            className="absolute inset-y-0 right-0 z-10 w-80 max-w-full overflow-auto border-l border-slate-200 bg-white p-4 shadow-xl"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Files size={17} />
              <span className="flex-1">文件收发</span>
              <button
                className={button}
                aria-label="收起文件"
                onClick={() => setFilesOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-6 text-slate-500">
              拖入文件发送到手机的 Echo 收发目录。手机上选择文件 → 分享 → Echo
              文件收发，电脑会自动更新列表。
            </p>
            <label
              className={`mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-5 text-xs text-blue-700 ${!online ? "opacity-40" : "hover:bg-blue-50"}`}
            >
              <FileUp size={24} />
              <span>选择文件或拖到这里</span>
              <span className="text-[10px] text-slate-400">
                单文件最大 100 MiB · 校验后完成
              </span>
              <input
                aria-label="发送文件到手机"
                type="file"
                multiple
                className="sr-only"
                disabled={!online}
                onChange={(event) => {
                  for (const file of Array.from(event.target.files || []))
                    startTransfer(file, true);
                  event.target.value = "";
                }}
              />
            </label>
            <PhoneTransferList deviceId={selected} />
            <div className="mb-3 mt-6 flex items-center justify-between">
              <span className="text-xs font-medium">
                手机收发目录 · {totalFiles} 个文件
              </span>
              <button
                className={button}
                disabled={!online}
                aria-label="刷新手机文件"
                onClick={() => void refreshFiles()}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            {fileError && (
              <p role="alert" className="mb-3 text-xs text-red-600">
                {fileError}
              </p>
            )}
            {!files.length && (
              <p className="py-6 text-center text-xs text-slate-400">
                {online ? "目录暂无文件" : "设备连接后显示文件"}
              </p>
            )}
            {files.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-2 border-b border-slate-100 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs" title={file.name}>
                    {file.name}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {sizeLabel(file.size)}
                  </p>
                </div>
                <button
                  className={button}
                  aria-label={`下载 ${file.name}`}
                  disabled={!online}
                  onClick={() => void startTransfer(file, false)}
                >
                  <ArrowDownToLine size={14} />
                </button>
              </div>
            ))}
            {files.length < totalFiles && (
              <button
                className={`${button} mt-3`}
                onClick={() => void refreshFiles(files.length)}
              >
                加载更多
              </button>
            )}
          </aside>
        )}
      </div>
      <DesktopCast deviceId={selected} online={online} />
    </div>
  );
}
