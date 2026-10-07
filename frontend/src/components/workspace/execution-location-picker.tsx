import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  Loader2Icon,
  MonitorIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getLocalBackendBaseURL } from "@/core/config";
import {
  executionLocationURL,
  getRemoteExecutionId,
} from "@/core/execution-location";
import { useI18n } from "@/core/i18n/hooks";
import { useRemoteBackends } from "@/hooks/use-remote-backends";
import { RemoteBackendsPanel } from "./remote-backends-panel";

export function ExecutionLocationPicker({
  disabled = false,
  onNavigate = (url: string) => window.location.assign(url),
}: {
  disabled?: boolean;
  onNavigate?: (url: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const copy = {
    title: zh ? "执行位置" : "Run in",
    local: zh ? "本机" : "This computer",
    localDescription: zh
      ? "在当前 Echo 服务运行"
      : "Run on the current Echo service",
    remote: zh ? "远程" : "Remote",
    remoteDescription: zh
      ? "在已连接的电脑运行"
      : "Run on a connected computer",
    cloud: zh ? "云端" : "Cloud",
    notConfigured: zh ? "未配置" : "Not configured",
    cloudDescription: zh
      ? "尚未连接托管平台或云端执行服务"
      : "No hosted platform or cloud executor connected",
    choose: zh ? "选择电脑" : "Choose computer",
    search: zh ? "搜索远程电脑…" : "Search remote computers…",
    manage: zh ? "管理远程电脑" : "Manage remote computers",
    newTask: zh
      ? "切换后打开所选电脑的新任务，当前聊天保留。"
      : "Switching opens a new task on that computer. This chat is preserved.",
    locked: zh
      ? "发送或清空草稿，并等待当前任务完成后切换"
      : "Send or clear the draft and wait for the current task before switching",
    flagOff: zh
      ? "当前服务未启用远程连接"
      : "Remote connections are disabled on this service",
    loadError: zh
      ? "无法读取远程电脑，请检查连接或权限"
      : "Cannot load computers. Check the connection or your permissions",
    empty: zh ? "还没有连接远程电脑" : "No remote computers added",
    noMatch: zh ? "没有匹配的电脑" : "No matching computers",
    checking: zh ? "正在检查连接…" : "Checking connection…",
    offline: zh
      ? "连接失败，请检查远程服务或凭据"
      : "Connection failed. Check the remote service or credentials",
    untested: zh ? "未检查" : "Not checked",
    online: zh ? "可连接" : "Reachable",
    unreachable: zh ? "上次连接失败" : "Last connection failed",
    retry: zh ? "重新检查" : "Retry",
  };
  const remoteId = getRemoteExecutionId();
  const baseUrl = getLocalBackendBaseURL();
  const registry = useRemoteBackends({ baseUrl });
  const selected = registry.backends.find((backend) => backend.id === remoteId);
  const [targetOpen, setTargetOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const switchGeneration = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (disabled) {
      switchGeneration.current += 1;
      setCheckingId(null);
      setTargetOpen(false);
    }
  }, [disabled]);
  useEffect(
    () => () => {
      switchGeneration.current += 1;
    },
    [],
  );

  async function chooseComputer(id: string) {
    if (disabled || checkingId || id === remoteId) return;
    const generation = ++switchGeneration.current;
    setCheckingId(id);
    try {
      const result = await registry.ping(id);
      if (generation !== switchGeneration.current) return;
      if (result.status !== "ok") {
        toast.error(copy.offline);
        return;
      }
      onNavigate(executionLocationURL(id));
    } catch {
      if (generation === switchGeneration.current) toast.error(copy.offline);
    } finally {
      if (generation === switchGeneration.current) setCheckingId(null);
    }
  }

  const controlClass =
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
  const filtered = registry.backends.filter((backend) =>
    `${backend.name} ${backend.ssh?.host ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-0.5"
      data-testid="execution-location-picker"
    >
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void registry.refresh();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={controlClass}
            disabled={disabled || Boolean(checkingId)}
            aria-label={`${copy.title}: ${remoteId ? copy.remote : copy.local}`}
            title={disabled ? copy.locked : copy.title}
            data-testid="execution-location-trigger"
          >
            {remoteId ? (
              <ServerIcon className="size-3.5 shrink-0" />
            ) : (
              <MonitorIcon className="size-3.5 shrink-0" />
            )}
            <span>{remoteId ? copy.remote : copy.local}</span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-64 max-w-[calc(100vw-2rem)] rounded-xl p-1.5"
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {copy.title}
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => {
              if (remoteId && !disabled) onNavigate(executionLocationURL(null));
            }}
          >
            <MonitorIcon className="size-4" />
            <div className="min-w-0 flex-1">
              <div>{copy.local}</div>
              <div className="text-xs text-muted-foreground">
                {copy.localDescription}
              </div>
            </div>
            {!remoteId && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={
              !registry.enabled || Boolean(registry.error) || registry.loading
            }
            onSelect={() => setTargetOpen(true)}
          >
            <ServerIcon className="size-4" />
            <div className="min-w-0 flex-1">
              <div>{copy.remote}</div>
              <div className="text-xs text-muted-foreground">
                {registry.error
                  ? copy.loadError
                  : registry.enabled
                    ? copy.remoteDescription
                    : copy.flagOff}
              </div>
            </div>
            {remoteId && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <CloudIcon className="size-4" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span>{copy.cloud}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal">
                  {copy.notConfigured}
                </span>
              </div>
              <div className="mt-0.5 text-xs leading-5">
                {copy.cloudDescription}
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <Settings2Icon className="size-3.5" />
            {copy.manage}
          </DropdownMenuItem>
          <div className="px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
            {copy.newTask}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu
        open={targetOpen && !disabled}
        onOpenChange={(open) => {
          setTargetOpen(open);
          if (open) {
            setQuery("");
            void registry.refresh();
          } else {
            switchGeneration.current += 1;
            setCheckingId(null);
          }
        }}
      >
        {(remoteId || targetOpen) && (
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled || Boolean(checkingId)}
              className={controlClass}
              aria-label={copy.choose}
              title={selected?.name ?? copy.choose}
            >
              <span className="max-w-32 truncate">
                {selected?.name ?? copy.choose}
              </span>
              <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-1.5"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-2 px-2 py-1.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" && event.key !== "Tab")
                  event.stopPropagation();
              }}
              placeholder={copy.search}
              aria-label={copy.search}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <DropdownMenuSeparator />
          {registry.loading && registry.backends.length === 0 ? (
            <div
              role="status"
              className="px-2 py-3 text-xs text-muted-foreground"
            >
              {copy.checking}
            </div>
          ) : registry.error || !registry.enabled ? (
            <div
              role="status"
              className="px-2 py-3 text-xs text-muted-foreground"
            >
              {registry.error ? copy.loadError : copy.flagOff}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {query ? copy.noMatch : copy.empty}
            </div>
          ) : (
            filtered.map((backend) => (
              <DropdownMenuItem
                key={backend.id}
                disabled={Boolean(checkingId)}
                onSelect={(event) => {
                  event.preventDefault();
                  void chooseComputer(backend.id);
                }}
              >
                {checkingId === backend.id ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <ServerIcon className="size-4" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{backend.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {backend.ssh ? "SSH · " : ""}
                    {backend.last_health === "ok"
                      ? copy.online
                      : backend.last_health === "error"
                        ? copy.unreachable
                        : copy.untested}
                  </div>
                </div>
                {backend.id === remoteId && <CheckIcon className="size-3.5" />}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void registry.refresh();
            }}
            disabled={registry.loading || Boolean(checkingId)}
          >
            {copy.retry}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <Settings2Icon className="size-3.5" />
            {copy.manage}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open);
          if (!open) void registry.refresh();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{copy.manage}</DialogTitle>
            <DialogDescription>{copy.newTask}</DialogDescription>
          </DialogHeader>
          <RemoteBackendsPanel baseUrl={baseUrl} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
