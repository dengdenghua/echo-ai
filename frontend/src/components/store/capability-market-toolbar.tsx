import { RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CapabilityTypeFilter =
  | "all"
  | "mcp"
  | "cli"
  | "skill-only"
  | "plugin";

/** 插件市场顶部工具栏:类型筛选 + 搜索 + 手动填开关 + 刷新。 */
export function CapabilityMarketToolbar({
  typeFilter,
  onTypeFilterChange,
  counts,
  visibleCount,
  totalCount,
  query,
  onQueryChange,
  showManual,
  onToggleManual,
  loading,
  onRefresh,
}: {
  typeFilter: CapabilityTypeFilter;
  onTypeFilterChange: (filter: CapabilityTypeFilter) => void;
  counts: Record<string, number>;
  visibleCount: number;
  totalCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  showManual: boolean;
  onToggleManual: () => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={typeFilter === "all" ? "secondary" : "ghost"}
          onClick={() => onTypeFilterChange("all")}
          className="h-8 px-2.5 text-xs"
        >
          全部
          <span className="ml-1 text-xs text-muted-foreground">
            {counts.all}
          </span>
        </Button>
        {(["all", "mcp", "cli", "skill-only", "plugin"] as const).map((tp) => (
          <Button
            key={tp}
            type="button"
            size="sm"
            variant={typeFilter === tp ? "secondary" : "ghost"}
            onClick={() => onTypeFilterChange(tp)}
            className="h-8 px-2.5 text-xs"
          >
            {tp === "all"
              ? "全部类型"
              : tp === "mcp"
                ? "MCP"
                : tp === "cli"
                  ? "CLI"
                  : tp === "plugin"
                    ? "插件"
                    : "技能"}
            <span className="ml-1 text-xs text-muted-foreground">
              {counts[tp] ?? 0}
            </span>
          </Button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {visibleCount}/{totalCount}
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="搜索插件"
            aria-label="搜索插件"
            className="h-8 w-44 rounded-md border border-border-default bg-background pl-7 pr-2 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <Button
          size="sm"
          variant={showManual ? "secondary" : "ghost"}
          disabled={loading}
          onClick={onToggleManual}
          title="显示只能手动填 token、不能跳网页授权的插件"
        >
          {showManual ? "隐藏手动填" : "显示手动填"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={onRefresh}
          title="刷新能力列表"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}
