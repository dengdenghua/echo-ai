import { serviceErrorMessage } from "@/core/utils/service-error";
import { useEffect, useState } from "react";
import { ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  isNASUnavailableError,
  listNASDirectory,
  NASRequestTimeoutError,
  type NASManifest,
} from "@/core/storage/api";
import { cn } from "@/lib/utils";

import { formatBytes, type DiskItem } from "./storage-helpers";
import { ToolbarSearch } from "./storage-file-ui";

export function LocalDiskView({
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
}: {
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
}) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<DiskItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [browseRevision, setBrowseRevision] = useState(0);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const { t } = useI18n();
  const directoryUnavailable = t.storage.service.directoryUnavailable;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setBrowseError(null);
      try {
        const body = await listNASDirectory(currentPath);
        if (cancelled) return;
        setEntries(
          body.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type === "dir" ? "文件夹" : "文件",
            size: entry.type === "dir" ? "—" : formatBytes(entry.size ?? 0),
            icon: entry.type === "dir" ? FolderIcon : FileTextIcon,
            isDirectory: entry.type === "dir",
          })),
        );
      } catch (error) {
        if (!cancelled) {
          setBrowseError(
            error instanceof NASRequestTimeoutError
              ? "本地服务连接超时，目录尚未读取。请检查连接后重试。"
              : isNASUnavailableError(error)
                ? directoryUnavailable
                : serviceErrorMessage(error),
          );
          setEntries([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [currentPath, browseRevision, directoryUnavailable]);

  const pathParts = currentPath.split("/").filter(Boolean);
  const goUp = () => {
    if (pathParts.length > 0)
      setCurrentPath(`/${pathParts.slice(0, -1).join("/")}`);
  };

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:px-3 lg:py-0">
        <div className="flex min-w-0 flex-wrap items-center text-sm">
          {pathParts.map((item, index, items) => (
            <span key={item} className="flex min-w-0 items-center">
              <button
                type="button"
                onClick={() =>
                  setCurrentPath(`/${pathParts.slice(0, index + 1).join("/")}`)
                }
                className={cn(
                  "max-w-32 truncate rounded px-1.5 py-1",
                  index === items.length - 1
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item}
              </button>
              {index < items.length - 1 && (
                <ChevronRightIcon className="mx-0.5 size-3 text-muted-foreground" />
              )}
            </span>
          ))}
          <button
            type="button"
            onClick={goUp}
            disabled={pathParts.length === 0}
            className="ml-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30"
          >
            返回上一级
          </button>
          <span className="ml-1 text-xs text-muted-foreground">
            ·{" "}
            {isLoading
              ? "正在读取"
              : browseError
                ? "未读取"
                : `${entries.length} 项`}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ToolbarSearch
            label="在当前位置中搜索："
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_96px_36px] gap-3 border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>名称</span>
            <span>类型</span>
            <span>项目</span>
            <span />
          </div>
          <div className="min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                正在读取目录…
              </div>
            ) : entries.length > 0 ? (
              entries.map((item) => (
                <LocalDiskEntryRow
                  key={item.path}
                  item={item}
                  onOpen={
                    item.isDirectory
                      ? () => setCurrentPath(item.path)
                      : undefined
                  }
                />
              ))
            ) : (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                {browseError ? "无法读取当前目录" : "当前目录为空"}
              </div>
            )}
          </div>
          <div className="border-t border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {browseError && (
              <Button
                variant="outline"
                size="sm"
                className="mr-3"
                onClick={() => setBrowseRevision((value) => value + 1)}
              >
                重试读取
              </Button>
            )}
            {browseError ||
              (manifest
                ? "本地路径与索引已连接。"
                : isLoading
                  ? "正在连接目录服务…"
                  : "目录服务尚未连接。")}
          </div>
        </main>
      </div>
    </>
  );
}

function LocalDiskEntryRow({
  item,
  onOpen,
}: {
  item: DiskItem;
  onOpen?: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="grid w-full grid-cols-[minmax(0,1fr)_120px_96px_36px] items-center gap-3 border-b border-black/[0.035] px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-border">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.path}
          </span>
        </span>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {item.type}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {item.size}
      </span>
      <ChevronRightIcon className="ml-auto size-4 text-muted-foreground" />
    </button>
  );
}
