import { useEffect, useState } from "react";
import {
  Boxes,
  ChevronDown,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plug,
  Plus,
  SquareTerminal,
  Trash2,
  Unplug,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  loadCapabilityIcon,
  type CapabilityInfo,
} from "@/core/agents/agent-world-api";
import { getBackendBaseURL } from "@/core/config";
import { cn } from "@/lib/utils";

import {
  AUTH_LABEL,
  DEFAULT_TYPE_META,
  TYPE_META,
  type CapabilityCategoryId,
} from "./capability-categories";

function capabilityIconUrl(capability: CapabilityInfo): string | null {
  const raw = capability.icon?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${getBackendBaseURL()}${raw}`;
  if (capability.source !== "codex_plugin") return null;
  if (capability.is_codex_marketplace) {
    return `${getBackendBaseURL()}/api/capabilities/${encodeURIComponent(capability.id)}/icon`;
  }
  const relative = raw.replace(/^\.\//, "");
  if (!relative || relative.split("/").some((part) => !part || part === "..")) {
    return null;
  }
  const encodedPath = relative
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${getBackendBaseURL()}/api/plugins/${encodeURIComponent(capability.id)}/assets/${encodedPath}`;
}

function useCapabilityIconUrl(capability: CapabilityInfo): string | null {
  const directUrl = capabilityIconUrl(capability);
  const backendApiPrefix = `${getBackendBaseURL()}/api/`;
  const requiresAuthentication = Boolean(
    directUrl && directUrl.startsWith(backendApiPrefix),
  );
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    requiresAuthentication ? null : directUrl,
  );

  useEffect(() => {
    if (!directUrl || !requiresAuthentication) {
      setResolvedUrl(directUrl);
      return;
    }
    const controller = new AbortController();
    setResolvedUrl(null);
    void loadCapabilityIcon(directUrl, controller.signal)
      .then((url) => setResolvedUrl(url || null))
      .catch(() => {
        if (!controller.signal.aborted) setResolvedUrl(null);
      });
    return () => controller.abort();
  }, [directUrl, requiresAuthentication]);

  return resolvedUrl;
}

function CapabilityIcon({ capability }: { capability: CapabilityInfo }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = useCapabilityIconUrl(capability);
  useEffect(() => setFailed(false), [imageUrl]);
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        data-testid={`capability-icon-${capability.id}`}
        className="size-8 object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  const raw = capability.icon?.trim();
  if (raw && !raw.includes("/") && !/^https?:/i.test(raw)) {
    return <span className="text-lg leading-none">{raw}</span>;
  }
  if (capability.source === "codex_plugin") {
    return <Boxes className="size-4 text-primary" />;
  }
  if (capability.type === "mcp") {
    return <Plug className="size-4 text-primary" />;
  }
  if (capability.type === "cli") {
    return <SquareTerminal className="size-4 text-primary" />;
  }
  return <Boxes className="size-4 text-primary" />;
}

export function CapabilityCategoryHeader({
  id,
  label,
  count,
  collapsed,
  onToggle,
}: {
  id: CapabilityCategoryId;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      data-testid={`plugin-category-${id}`}
      onClick={onToggle}
      className="group col-span-full flex h-10 items-center gap-2 border-b border-border-subtle px-1 text-left"
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
      <ChevronDown
        className={cn(
          "ml-auto size-4 text-muted-foreground transition-transform duration-base",
          collapsed && "-rotate-90",
        )}
      />
    </button>
  );
}

type CapabilityAction = (capability: CapabilityInfo) => Promise<void>;

export interface CapabilityMarketCardProps {
  capability: CapabilityInfo;
  compact: boolean;
  /** 精选视图使用更高、信息更少的卡片。 */
  featured: boolean;
  busy?: boolean;
  /** undefined 表示尚未读取连接状态。 */
  connected?: boolean;
  statusError?: string | null;
  onInstall: CapabilityAction;
  onTry: CapabilityAction;
  onReviewPermissions: CapabilityAction;
  onConnect: CapabilityAction;
  onDisable: CapabilityAction;
  onDisconnect: CapabilityAction;
  onUninstall: CapabilityAction;
  onRefreshStatus: CapabilityAction;
}

/** 插件市场里的一张能力卡片:状态徽标 + 安装/管理菜单。 */
export function CapabilityMarketCard({
  capability: cap,
  compact,
  featured: isFeaturedView,
  busy,
  connected,
  statusError,
  onInstall,
  onTry,
  onReviewPermissions,
  onConnect,
  onDisable,
  onDisconnect,
  onUninstall,
  onRefreshStatus,
}: CapabilityMarketCardProps) {
  const typeMeta = TYPE_META[cap.type] ?? DEFAULT_TYPE_META;
  const needsConnection =
    cap.auth_mode !== "none" ||
    Boolean(cap.model_provider || cap.has_cli_auth || cap.oauth_supported);
  const needsModelConfiguration = Boolean(cap.model_provider) && !connected;
  const isPlugin = cap.source === "codex_plugin";
  const isCodexMarketplace = cap.is_codex_marketplace === true;
  return (
    <Card
      data-capability-id={cap.id}
      className={cn(
        "gap-2.5 py-3 transition-colors hover:border-primary/40",
        isFeaturedView && !compact && "min-h-44 rounded-xl py-4",
        compact &&
          "grid min-h-20 grid-cols-[minmax(0,1fr)_auto] grid-rows-1 items-center gap-x-3 gap-y-0 rounded-lg border-0 bg-transparent py-3 shadow-none hover:bg-muted/25 hover:shadow-none",
      )}
    >
      <CardHeader
        className={cn(
          "flex min-w-0 flex-row items-center gap-3 px-3 pt-0",
          compact && "col-start-1 row-start-1 pr-0",
        )}
      >
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-default bg-muted text-base",
            compact && "size-9 rounded-lg border-0 bg-transparent",
          )}
        >
          <CapabilityIcon capability={cap} />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <CardTitle className="truncate text-sm leading-5">
            {cap.name_zh}
          </CardTitle>
          <CardDescription className="truncate text-xs">
            {compact
              ? cap.description_zh || cap.description
              : isFeaturedView
                ? `来自 ${cap.author || "ECHO"}`
                : `${cap.id} · ${AUTH_LABEL[cap.auth_mode] ?? cap.auth_mode}`}
          </CardDescription>
          {compact && cap.author ? (
            <p className="truncate text-xs text-muted-foreground">
              来自 {cap.author}
            </p>
          ) : null}
          {cap.ownership_label && (
            <p className="text-xs text-muted-foreground">
              {cap.ownership_label}
            </p>
          )}
        </div>
      </CardHeader>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 px-3",
          compact && "hidden",
        )}
      >
        <Badge className={cn("border-transparent text-xs", typeMeta.badge)}>
          {typeMeta.label}
        </Badge>
        {isPlugin ? (
          <Badge className="border-transparent bg-muted text-xs text-muted-foreground">
            Codex
          </Badge>
        ) : null}
        {isCodexMarketplace && cap.marketplace_name ? (
          <Badge
            variant="outline"
            className="text-xs font-normal text-muted-foreground"
          >
            {cap.marketplace_name}
          </Badge>
        ) : null}
        {!isFeaturedView && (cap.oauth_supported || cap.has_cli_auth) && (
          <Badge
            className="border-transparent bg-muted text-xs text-muted-foreground"
            title="支持跳转网页登录授权,无需手动填 token"
          >
            网页登录
          </Badge>
        )}
        {!isFeaturedView ? (
          <Badge
            variant="outline"
            className="text-xs font-normal text-muted-foreground"
          >
            技能 ×{cap.skill_count}
          </Badge>
        ) : null}
        {!isFeaturedView && cap.mcp_servers.length > 0 && (
          <Badge
            variant="outline"
            className="text-xs font-normal text-muted-foreground"
          >
            MCP ×{cap.mcp_servers.length}
          </Badge>
        )}
        {cap.installed && (
          <Badge
            className={cn(
              "border-transparent text-xs",
              cap.enabled && (!needsConnection || connected)
                ? "bg-core/15 text-core"
                : "bg-warning/15 text-warning",
            )}
          >
            {statusError
              ? "状态未读取"
              : cap.permission_review_required
                ? "待确认权限"
                : needsModelConfiguration
                  ? "待配置"
                  : !cap.enabled
                    ? "已停用"
                    : !needsConnection
                      ? "已启用"
                      : connected
                        ? "已连接"
                        : "待连接"}
          </Badge>
        )}
        {cap.permission_review_required ? (
          <Badge className="border-transparent bg-warning/15 text-xs text-warning">
            待确认权限
          </Badge>
        ) : null}
      </div>

      <div className={cn("px-3", compact && "hidden")}>
        <p
          className={cn(
            "text-xs leading-5 text-muted-foreground",
            compact ? "line-clamp-1" : "line-clamp-2",
          )}
        >
          {cap.description_zh || cap.description}
        </p>
        {cap.author && !isFeaturedView ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            作者:{cap.author}
          </p>
        ) : null}
      </div>

      {statusError || (!cap.installed && cap.installable === false) ? (
        <div
          className="px-3 text-xs text-muted-foreground sm:col-span-full"
          role="status"
        >
          {statusError ? (
            <>
              <span>连接状态未读取：{statusError}</span>
              <Button
                size="sm"
                variant="link"
                className="h-auto px-1 text-xs"
                onClick={() => void onRefreshStatus(cap)}
              >
                重读状态
              </Button>
            </>
          ) : (
            "当前账号或工作区不允许安装，请联系此部署的管理员检查插件权限。"
          )}
        </div>
      ) : null}

      <CardFooter
        className={cn(
          "flex flex-wrap gap-1.5 px-3 pb-0",
          compact &&
            "col-start-2 row-start-1 flex-nowrap self-center justify-end pl-0 pr-3",
        )}
      >
        {!cap.installed ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 rounded-md text-muted-foreground"
            disabled={busy || cap.installable === false}
            onClick={() => void onInstall(cap)}
            aria-label={`安装 ${cap.name_zh || cap.name}`}
            title={
              cap.installable === false ? "当前账号或工作区不允许安装" : "安装"
            }
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
          </Button>
        ) : (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-md text-muted-foreground"
                  disabled={busy}
                  aria-label={`管理 ${cap.name_zh || cap.name}`}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onSelect={() => void onTry(cap)}>
                  <Plug className="size-4" />
                  试用
                </DropdownMenuItem>
                {!isCodexMarketplace && cap.permission_review_required ? (
                  <DropdownMenuItem
                    onSelect={() => void onReviewPermissions(cap)}
                  >
                    确认权限
                  </DropdownMenuItem>
                ) : !isCodexMarketplace && needsModelConfiguration ? (
                  <DropdownMenuItem onSelect={() => void onConnect(cap)}>
                    配置模型
                  </DropdownMenuItem>
                ) : null}
                {!isCodexMarketplace && cap.enabled && (
                  <DropdownMenuItem
                    disabled={cap.lifecycle_manageable === false}
                    onSelect={() => void onDisable(cap)}
                  >
                    停用插件
                  </DropdownMenuItem>
                )}
                {!isCodexMarketplace &&
                  needsConnection &&
                  !connected &&
                  (cap.enabled || !needsModelConfiguration) && (
                    <DropdownMenuItem
                      disabled={cap.permission_review_required}
                      onSelect={() => void onConnect(cap)}
                    >
                      <KeyRound className="size-4" />
                      连接
                    </DropdownMenuItem>
                  )}
                {!isCodexMarketplace && needsConnection && connected && (
                  <DropdownMenuItem
                    disabled={cap.permission_review_required}
                    onSelect={() => void onDisconnect(cap)}
                  >
                    <Unplug className="size-4" />
                    断开连接
                  </DropdownMenuItem>
                )}
                {!isCodexMarketplace && cap.enabled && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem
                  disabled={cap.lifecycle_manageable === false}
                  onSelect={() => void onUninstall(cap)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4" />
                  卸载插件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
