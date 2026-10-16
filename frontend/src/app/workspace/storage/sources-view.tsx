import {
  FolderPlusIcon,
  HardDriveIcon,
  LockKeyholeIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  getNASBaseURL,
  type NASManifest,
  type NASPolicy,
  type NASSource,
} from "@/core/storage/api";
import { isAbsolutePath } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

export function SourcesView({
  sources,
  stats,
  manifest,
  serviceError,
  isPickingFolder,
  isReconnecting,
  onPickFolder,
  onReconnect,
  onScan,
  onTogglePrivacy,
  isIndexing,
  policy,
  onRemoveSource,
}: {
  sources: NASSource[];
  stats: { files: number; chunks: number; sources: number };
  manifest: NASManifest | null;
  serviceError: string | null;
  isPickingFolder: boolean;
  isReconnecting: boolean;
  onPickFolder: () => void;
  onReconnect: () => void;
  onScan: () => void;
  onTogglePrivacy: () => void;
  isIndexing: boolean;
  policy: NASPolicy;
  onRemoveSource: (id: string) => Promise<void>;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">授权目录</div>
          <div className="truncate text-xs text-muted-foreground">
            管理已授权目录、索引状态与扫描范围
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="h-8 rounded-md bg-primary px-2.5 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={onPickFolder}
            disabled={isPickingFolder}
          >
            <FolderPlusIcon className="size-3.5" />
            添加
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="扫描队列"
            className="size-8 rounded-md"
            onClick={onScan}
            disabled={!manifest || isIndexing}
          >
            <RefreshCwIcon
              className={cn("size-4", isIndexing && "animate-spin")}
            />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="隐私策略"
            className="size-8 rounded-md"
            onClick={onTogglePrivacy}
            title={
              policy.mode === "privacy" ? "切换为效率模式" : "切换为隐私模式"
            }
          >
            {policy.mode === "privacy" ? (
              <LockKeyholeIcon className="size-4" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 gap-2 border-b border-border bg-muted/30 p-3 sm:grid-cols-3">
        <Metric label="授权目录" value={String(stats.sources)} />
        <Metric label="扫描文件" value={String(stats.files)} />
        <Metric label="索引片段" value={String(stats.chunks)} />
      </div>

      {!manifest && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="font-medium">下一步：重新连接本地知识库服务</div>
            <div className="mt-0.5 truncate text-warning/80">
              {serviceError || `当前未连接 ${getNASBaseURL()}`}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 rounded-md border-warning/40 bg-card px-3 text-warning hover:bg-warning/10"
            onClick={onReconnect}
            disabled={isReconnecting}
          >
            <RefreshCwIcon
              className={cn("size-3.5", isReconnecting && "animate-spin")}
            />
            {isReconnecting ? "连接中" : "重新连接"}
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-end gap-3 border-b border-border px-3 py-2">
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <Badge
            variant="outline"
            className="rounded-md border-border bg-card text-xs"
          >
            本地索引
          </Badge>
          <Badge
            variant="outline"
            className="rounded-md border-border bg-card text-xs"
          >
            原文件不上传
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="hidden grid-cols-[minmax(260px,1fr)_92px_92px_120px] border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>目录</span>
          <span>文件</span>
          <span>片段</span>
          <span className="text-right">状态</span>
        </div>
        {sources.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
            <div className="grid size-14 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-xs)]">
              <FolderPlusIcon className="size-7" />
            </div>
            <div className="mt-4 text-base font-semibold">
              {manifest
                ? "选择一个本机文件夹开始建索引"
                : "先恢复本地服务，再添加文件夹"}
            </div>
            <div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {manifest
                ? "资料库会在本机解析文件、OCR 图片并生成向量索引。原文件不上传；只有你确认引用的片段会进入任务上下文。"
                : "离线时可以浏览常用位置，但无法扫描新目录。重新连接后再添加文件夹，索引会在本机生成。"}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Button
                className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={manifest ? onPickFolder : onReconnect}
                disabled={manifest ? isPickingFolder : isReconnecting}
              >
                {manifest ? (
                  <FolderPlusIcon className="size-4" />
                ) : (
                  <RefreshCwIcon
                    className={cn("size-4", isReconnecting && "animate-spin")}
                  />
                )}
                {manifest
                  ? "添加文件夹"
                  : isReconnecting
                    ? "连接中"
                    : "重新连接"}
              </Button>
              <Button
                variant="secondary"
                className="rounded-md bg-muted"
                onClick={onTogglePrivacy}
              >
                <ShieldCheckIcon className="size-4" />
                查看隐私策略
              </Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sources.map((source) => (
              <SourceRow
                key={source.source_id}
                source={source}
                onRemove={() => void onRemoveSource(source.source_id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>隐私机制: 文件解析、OCR 与向量索引默认落在本机。</span>
          <span>
            扫描状态: {isIndexing ? "正在更新索引…" : "当前无运行任务"}
          </span>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-background/80 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function SourceRow({
  source,
  onRemove,
}: {
  source: NASSource;
  onRemove: () => void;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const isReady = source.status === "ready";
  const displayPath = isAbsolutePath(source.path) ? source.path : source.path;
  return (
    <div className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(260px,1fr)_92px_92px_120px] md:items-center md:gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <HardDriveIcon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate font-medium">{source.display_name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {displayPath}
          </div>
        </div>
      </div>
      <div className="flex items-center text-xs text-muted-foreground md:block">
        {source.file_count} 文件
      </div>
      <div className="flex items-center text-xs text-muted-foreground md:block">
        {source.chunk_count} 片段
      </div>
      <div className="flex items-center gap-2 md:justify-end">
        <Badge
          variant="outline"
          className={cn(
            "h-5 px-1.5 text-xs",
            isReady
              ? "border-success/55 bg-success/5 text-success"
              : "border-warning/55 bg-warning/5 text-warning",
          )}
        >
          {isReady ? "已就绪" : "待索引"}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (
              await confirm({
                title: "移除授权目录",
                description: `将移除「${source.display_name}」及其索引数据，此操作不可撤销。`,
                confirmLabel: "移除",
              })
            ) {
              onRemove();
            }
          }}
        >
          移除
        </Button>
      </div>
      {confirmDialog}
    </div>
  );
}
