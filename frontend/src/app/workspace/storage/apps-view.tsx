import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopyIcon,
  FolderSearchIcon,
  LayoutListIcon,
  PlayIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useDesktopApps } from "@/core/apps/desktop-apps";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { copyTextToClipboard } from "@/core/clipboard";
import {
  openNASApp,
  revealNASApp,
  type NASApp,
  type NASManifest,
} from "@/core/storage/api";
import { cn } from "@/lib/utils";

import { fill, mapNASApp, useNASAsset, type AppItem } from "./storage-helpers";
import { ToolbarSearch } from "./storage-file-ui";

export function AppsView({
  apps,
  query,
  setQuery,
  runSearch,
  isSearching,
  manifest,
  error,
}: {
  apps: NASApp[];
  error?: string | null;
  query: string;
  setQuery: (value: string) => void;
  runSearch: () => void;
  isSearching: boolean;
  manifest: NASManifest | null;
}) {
  const { t } = useI18n();
  const copy = t.storage;
  const echoApps = useDesktopApps(t).filter(app => app.placement === "workbench");
  const [category, setCategory] = useState<"all" | "office" | "system">("all");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    item: AppItem;
    x: number;
    y: number;
  } | null>(null);
  const appItems = useMemo(
    () =>
      apps
        .filter((item) => category === "all" || item.category === category)
        .map((item) => mapNASApp(item, copy)),
    [apps, category, copy],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-app-context-menu]")
      )
        return;
      setContextMenu(null);
    };
    const closeOnScroll = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", closeOnScroll);
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", closeOnScroll);
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [contextMenu]);

  const launchApp = useCallback(async (item: AppItem) => {
    setSelectedAppId(item.id);
    setContextMenu(null);
    try {
      await openNASApp(item.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `无法打开 ${item.name}`,
      );
    }
  }, []);

  const revealApp = useCallback(async (item: AppItem) => {
    setContextMenu(null);
    try {
      await revealNASApp(item.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `无法定位 ${item.name}`,
      );
    }
  }, []);

  const copyAppPath = useCallback(async (item: AppItem) => {
    setContextMenu(null);
    try {
      await copyTextToClipboard(item.path);
      toast.success("应用路径已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }, []);
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted px-3 py-2 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-0">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {copy.apps.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {fill(copy.apps.subtitle, { count: appItems.length })}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ToolbarSearch
            label={copy.apps.searchLabel}
            query={query}
            setQuery={setQuery}
            runSearch={runSearch}
            isSearching={isSearching}
            manifest={manifest}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={copy.toolbar.sortAria}
            className="size-8 rounded-md"
          >
            <SlidersHorizontalIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={copy.toolbar.listViewAria}
            className="size-8 rounded-md"
          >
            <LayoutListIcon className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-card px-5 py-5"
        onPointerDown={() => setSelectedAppId(null)}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) event.preventDefault();
        }}
      >
        <section className="mb-8" aria-label="Echo 应用">
          <h2 className="mb-3 text-sm font-medium">Echo 应用</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {echoApps.map((app, index) => <Link key={app.id} to={app.route} className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: ["linear-gradient(145deg,#4089fa,#2459c8)","linear-gradient(145deg,#9b70ef,#6541bd)","linear-gradient(145deg,#38baaa,#157e79)","linear-gradient(145deg,#f2ae46,#ce711e)","linear-gradient(145deg,#ef799a,#c34271)"][index % 5] }}><app.icon className="size-6" strokeWidth={1.7} /></span><span className="text-sm">{app.name}</span>
            </Link>)}
          </div>
          <Link to="/workspace/plugins" className="mt-3 inline-block text-xs text-muted-foreground underline">管理应用与插件</Link>
        </section>
        <h2 className="mb-3 text-sm font-medium">本机软件</h2>
        {error && <p role="alert" className="mb-4 rounded-lg bg-muted p-3 text-sm">{error}</p>}
        <div className="mb-6 flex items-center gap-7 text-sm">
          {(
            [
              ["all", "全部应用"],
              ["office", "办公学习"],
              ["system", "系统应用"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={cn(
                "transition-colors hover:text-foreground",
                category === value
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-x-5 gap-y-10">
          {appItems.length > 0 ? (
            appItems.map((item) => (
              <AppListRow
                key={item.id}
                item={item}
                selected={selectedAppId === item.id}
                onOpen={() => void launchApp(item)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedAppId(item.id);
                  setContextMenu({
                    item,
                    x: Math.min(event.clientX, window.innerWidth - 224),
                    y: Math.min(event.clientY, window.innerHeight - 164),
                  });
                }}
              />
            ))
          ) : (
            <div className="col-span-full px-4 py-10 text-center text-sm text-muted-foreground">
              {error ? "本机应用列表暂不可用" : "没有找到匹配的本机应用"}
            </div>
          )}
        </div>
      </div>
      {contextMenu && (
        <div
          data-app-context-menu
          role="menu"
          aria-label={`${contextMenu.item.name} 操作`}
          className="fixed z-50 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-floating)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-border-subtle px-2.5 py-2">
            <div className="truncate text-xs font-semibold">
              {contextMenu.item.name}
            </div>
            <div className="mt-0.5 truncate text-mini text-muted-foreground">
              {contextMenu.item.path}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-accent"
            onClick={() => void launchApp(contextMenu.item)}
          >
            <PlayIcon className="size-3.5" />
            打开
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-accent"
            onClick={() => void revealApp(contextMenu.item)}
          >
            <FolderSearchIcon className="size-3.5" />
            在文件管理器中显示
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-accent"
            onClick={() => void copyAppPath(contextMenu.item)}
          >
            <CopyIcon className="size-3.5" />
            复制路径
          </button>
        </div>
      )}
    </>
  );
}

function AppListRow({
  item,
  selected,
  onOpen,
  onContextMenu,
}: {
  item: AppItem;
  selected: boolean;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const Icon = item.icon;
  const iconUrl = useNASAsset(item.iconUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <button
      type="button"
      title={`${item.path}\n单击打开，右键查看更多操作`}
      aria-label={`打开 ${item.name}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex min-w-0 flex-col items-center rounded-xl px-2 py-2 text-center outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40",
        selected && "bg-accent/70",
      )}
    >
      <span className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-black/[0.025] transition-transform group-hover:-translate-y-0.5 group-active:scale-95">
        {iconUrl && failedUrl !== iconUrl ? (
          <img src={iconUrl} alt="" className="size-14 object-contain" onError={() => setFailedUrl(iconUrl)} />
        ) : (
          <Icon className="size-7 text-muted-foreground" />
        )}
      </span>
      <span className="mt-2 line-clamp-2 min-h-8 max-w-24 text-xs leading-4">
        {item.name}
      </span>
    </button>
  );
}
