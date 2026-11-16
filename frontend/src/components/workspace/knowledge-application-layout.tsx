import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AppWindowIcon,
  ArrowLeftIcon,
  DatabaseIcon,
  FileImageIcon,
  FileTextIcon,
  FolderKeyIcon,
  HouseIcon,
  NetworkIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react";
import { useI18n } from "@/core/i18n/hooks";
import { WorkbenchSurfaceProvider } from "@/core/workbench/workbench-surface";
import { cn } from "@/lib/utils";

const KnowledgeApplicationContext = createContext(false);
export const useKnowledgeApplication = () =>
  useContext(KnowledgeApplicationContext);

/** An application surface, independent of the project and conversation sidebar. */
export function KnowledgeApplicationLayout({
  children,
  returnTo,
  desktopHref,
}: {
  children: ReactNode;
  returnTo: string;
  desktopHref?: string;
}) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith("zh");
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const graph = pathname.startsWith("/workspace/knowledge");
  const selected = graph ? "graph" : params.get("library") || "computer";
  const items = [
    { id: "computer", label: zh ? "检索" : "Search", icon: SearchIcon },
    {
      id: "sources",
      label: t.storage.libraries.sourcesLabel,
      icon: FolderKeyIcon,
    },
    { id: "docs", label: t.storage.libraries.docsLabel, icon: FileTextIcon },
    {
      id: "images",
      label: t.storage.libraries.imagesLabel,
      icon: FileImageIcon,
    },
    { id: "videos", label: t.storage.libraries.videosLabel, icon: VideoIcon },
    { id: "apps", label: t.storage.libraries.appsLabel, icon: AppWindowIcon },
    {
      id: "graph",
      label: zh ? "知识图谱" : "Knowledge graph",
      icon: NetworkIcon,
    },
  ];
  const target = (id: string) => {
    const next = new URLSearchParams(search);
    next.delete("file");
    next.delete("directory");
    if (id === "graph") next.delete("library");
    else next.set("library", id);
    const query = next.toString();
    return `${id === "graph" ? "/workspace/knowledge" : "/workspace/storage"}${query ? `?${query}` : ""}`;
  };
  return (
    <KnowledgeApplicationContext.Provider value={true}>
      <div
        data-testid="knowledge-application"
        className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5">
          <h1 className="flex items-center gap-2.5 text-sm font-semibold">
            <DatabaseIcon className="size-[18px] text-muted-foreground" />
            {zh ? "知识库" : "Knowledge"}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {desktopHref && (
              <Link
                to={desktopHref}
                className="flex min-h-8 items-center gap-1.5 rounded-md px-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HouseIcon className="size-3.5" />
                {zh ? "返回桌面" : "Desktop"}
              </Link>
            )}
            <Link
              to={returnTo}
              className="flex min-h-8 items-center gap-1.5 rounded-md px-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeftIcon className="size-3.5" />
              {zh ? "返回对话" : "Back to chat"}
            </Link>
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label={zh ? "知识库导航" : "Knowledge navigation"}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 bg-muted/20 p-2 md:w-[208px] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r md:p-3"
          >
            {items.map(({ id, label, icon: Icon }) => (
              <Link
                key={id}
                to={target(id)}
                aria-current={selected === id ? "page" : undefined}
                className={cn(
                  "flex min-h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected === id &&
                    "bg-foreground/[0.065] font-medium text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.7} />
                {label}
              </Link>
            ))}
            <p className="mt-auto hidden px-3 pb-2 pt-6 text-xs leading-5 text-muted-foreground/75 md:block">
              {zh
                ? "仅检索已授权的本机目录"
                : "Search authorized local folders"}
            </p>
          </nav>
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <WorkbenchSurfaceProvider surface="browser">
              {children}
            </WorkbenchSurfaceProvider>
          </main>
        </div>
      </div>
    </KnowledgeApplicationContext.Provider>
  );
}
