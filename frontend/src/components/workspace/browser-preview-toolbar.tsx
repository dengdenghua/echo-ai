import {
  ListIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  ImageIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  MonitorIcon,
  RefreshCwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  DEVICE_PREVIEW_PRESETS,
  isDevicePreviewPreset,
  type DevicePreviewPreset,
  type PreviewSurfaceMode,
} from "./browser-preview-model";

interface BrowserPreviewToolbarProps {
  urlInput: string;
  onUrlInputChange: (value: string) => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenFullBrowser: () => void;
  onEndSession: () => void;
  canLivePreview: boolean;
  surfaceMode: PreviewSurfaceMode;
  onSurfaceModeChange: (mode: PreviewSurfaceMode) => void;
  devicePreview: DevicePreviewPreset;
  viewportChanging: boolean;
  onDevicePreviewChange: (preset: DevicePreviewPreset) => void;
  onAttachScreenshot: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  sessionHealthy: boolean;
  sessionIdle?: boolean;
  runtimeLabel: string;
  returnToTask?: boolean;
  onToggleActionLog?: () => void;
  actionFailureCount?: number;
}

/**
 * The preview's persistent navigation row. Contextual screenshot actions stay
 * on the canvas so this toolbar keeps one stable browser-like hierarchy.
 */
export function BrowserPreviewToolbar({
  urlInput,
  onUrlInputChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onOpenFullBrowser,
  onEndSession,
  canLivePreview,
  surfaceMode,
  onSurfaceModeChange,
  devicePreview,
  viewportChanging,
  onDevicePreviewChange,
  onAttachScreenshot,
  autoRefresh,
  onAutoRefreshChange,
  sessionHealthy,
  sessionIdle = false,
  returnToTask = false,
  runtimeLabel,
  onToggleActionLog,
  actionFailureCount = 0,
}: BrowserPreviewToolbarProps) {
  const { t } = useI18n();
  const bp = t.browserPreviewPanel;
  const switchToLive = surfaceMode !== "live";

  return (
    <div
      role="toolbar"
      aria-label={t.browser.browserAutomation}
      className="@container/browser-preview-toolbar flex shrink-0 items-center gap-1.5 border-b border-border-default bg-background px-2 py-1.5"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onBack}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
          title={t.browser.back}
          aria-label={t.browser.back}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onForward}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
          title={t.browser.forward}
          aria-label={t.browser.forward}
        >
          <ArrowRightIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onReload}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
          title={t.browser.reload}
          aria-label={t.browser.reload}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate();
        }}
        className="flex min-w-0 flex-1 items-center"
      >
        <div className="relative flex h-9 min-w-0 flex-1 items-center rounded-md border border-transparent bg-muted/35 transition-colors hover:bg-muted/50 focus-within:border-ring focus-within:bg-background">
          <GlobeIcon className="absolute left-2.5 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={urlInput}
            onChange={(event) => onUrlInputChange(event.target.value)}
            placeholder={t.browser.urlPlaceholder}
            aria-label={t.browser.urlPlaceholder}
            className="h-full w-full bg-transparent pr-2 pl-8 text-sm outline-none"
          />
        </div>
      </form>

      <button
        type="button"
        onClick={onOpenFullBrowser}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
        title={returnToTask ? "返回任务" : bp.continueInFullBrowser}
        aria-label={returnToTask ? "返回任务" : bp.continueInFullBrowser}
      >
        {returnToTask ? (
          <ArrowLeftIcon className="size-3.5" />
        ) : (
          <Maximize2Icon className="size-3.5" />
        )}
        <span className="hidden @min-[520px]/browser-preview-toolbar:inline">
          {returnToTask ? "返回任务" : bp.takeoverButton}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
            title={t.common.more}
            aria-label={t.common.more}
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            disabled={!canLivePreview}
            onSelect={() =>
              onSurfaceModeChange(switchToLive ? "live" : "screenshot")
            }
          >
            {switchToLive ? (
              <MonitorIcon className="size-3.5" />
            ) : (
              <ImageIcon className="size-3.5" />
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className="font-medium">
                {switchToLive ? bp.switchToLivePreview : bp.switchToScreenshot}
              </span>
              <span className="whitespace-normal text-xs leading-snug text-muted-foreground">
                {switchToLive
                  ? bp.switchToLivePreviewDescription
                  : bp.switchToScreenshotDescription}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>设备预览</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <div className="px-2 py-1.5">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {bp.selectDevicePreset}
                </label>
                <select
                  value={devicePreview}
                  onChange={(event) => {
                    // The options below are exactly the preset keys.
                    const preset = event.target.value;
                    if (isDevicePreviewPreset(preset)) {
                      onDevicePreviewChange(preset);
                    }
                  }}
                  disabled={viewportChanging}
                  className="h-8 w-full rounded-md border border-border-default bg-background px-2 text-xs font-medium text-foreground outline-none"
                  aria-label={bp.selectDevicePreset}
                >
                  {Object.keys(DEVICE_PREVIEW_PRESETS)
                    .filter(isDevicePreviewPreset)
                    .map((preset) => {
                      const device = DEVICE_PREVIEW_PRESETS[preset];
                      return (
                        <option key={preset} value={preset}>
                          {preset === "desktop"
                            ? bp.desktopLabel
                            : device.label}
                        </option>
                      );
                    })}
                </select>
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>任务工具</DropdownMenuLabel>
          {onToggleActionLog && (
            <DropdownMenuItem onSelect={onToggleActionLog}>
              <ListIcon className="size-3.5" />
              {t.browser.actionLog}
              {actionFailureCount > 0 && (
                <span className="ml-auto text-xs text-destructive">
                  {bp.failureCount(actionFailureCount)}
                </span>
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onAttachScreenshot}>
            <ImageIcon className="size-3.5" />
            {bp.attachScreenshotToComposer}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAutoRefreshChange(!autoRefresh)}>
            {autoRefresh ? (
              <SquareIcon className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            {autoRefresh
              ? t.browser.stopAutoRefresh
              : t.browser.startAutoRefresh}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div
            role="status"
            aria-label={
              sessionHealthy ? bp.sessionHealthyLabel : bp.sessionAttentionLabel
            }
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                sessionIdle
                  ? "bg-muted-foreground"
                  : sessionHealthy
                    ? "bg-success"
                    : "bg-destructive",
              )}
            />
            <span className="min-w-0 flex-1 truncate">
              {runtimeLabel === "mock"
                ? "浏览器待启动，打开网址后连接"
                : runtimeLabel === "未连接"
                  ? "尚未连接浏览器"
                  : sessionIdle
                    ? "暂无浏览器操作记录"
                    : sessionHealthy
                      ? bp.sessionHealthyLabel
                      : bp.sessionAttentionLabel}
            </span>
            <span className="shrink-0 font-mono text-xs">{runtimeLabel}</span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onEndSession}>
            <XIcon className="size-3.5" />
            {bp.endSession}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
