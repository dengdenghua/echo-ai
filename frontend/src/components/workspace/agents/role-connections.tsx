import { lazy, Suspense, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import {
  inspectRequiredConnections,
  type RequiredConnectionState,
} from "@/core/agents/required-connections";

const ConnectionManager = lazy(() =>
  import("@/components/store/capability-market-panel").then((module) => ({
    default: module.CapabilityMarketPanel,
  })),
);

export function RoleConnections({
  agentId,
  connectors,
  mcpServers,
  onConfigured,
}: {
  agentId: string;
  connectors: string[];
  mcpServers: string[];
  onConfigured?: (configured: boolean) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [target, setTarget] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["role-connections", agentId, connectors],
    queryFn: ({ signal }) => inspectRequiredConnections(connectors, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: connectors.length > 0,
  });
  const labels: Record<RequiredConnectionState, string> = {
    missing: zh ? "未找到连接器" : "Connector not found",
    install: zh ? "需要安装" : "Installation required",
    permissions: zh ? "需要确认授权" : "Permission review required",
    disabled: zh ? "尚未启用" : "Not enabled",
    connect: zh ? "需要连接" : "Connection required",
    configured: zh ? "连接配置正常" : "Connection configured",
    unknown: zh ? "状态待确认" : "Status unconfirmed",
  };
  const rows = !query.isFetching && !query.isError ? query.data : undefined;
  const configured = Boolean(
    rows?.length === connectors.length &&
    connectors.length > 0 &&
    rows.every((item) => item.state === "configured") &&
    target === null &&
    mcpServers.length === 0,
  );
  useEffect(() => {
    onConfigured?.(configured);
    return () => onConfigured?.(false);
  }, [configured, onConfigured]);
  return (
    <div className="space-y-2 border-t border-border/60 pt-2">
      <p className="font-medium">
        {zh ? "此角色需要的连接" : "Connections required by this role"}
      </p>
      {query.isFetching && (
        <p role="status">{zh ? "正在检查连接…" : "Checking connections…"}</p>
      )}
      {query.isError && (
        <p role="alert">
          {zh ? "连接状态读取失败" : "Connection status unavailable"}
        </p>
      )}
      <ul className="max-h-36 space-y-2 overflow-y-auto">
        {rows?.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="min-w-0 break-all">
              {item.name} · {labels[item.state]}
            </span>
            <button
              type="button"
              className="shrink-0 underline underline-offset-4"
              onClick={() => setTarget(item.id)}
            >
              {zh ? "管理连接" : "Manage connection"}
            </button>
          </li>
        ))}
        {mcpServers.map((name) => (
          <li key={name} className="break-all">
            {name} ·{" "}
            {zh
              ? "外部 MCP 尚未验证，请在插件设置中配置"
              : "External MCP unverified; configure it in plugin settings"}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        {zh
          ? "连接配置正常仍需实际调用验证。"
          : "Configured connections still need a real call to verify them."}
      </p>
      {connectors.length > 0 && (
        <button
          type="button"
          disabled={query.isFetching}
          className="underline underline-offset-4 disabled:opacity-50"
          onClick={() => void query.refetch()}
        >
          {zh ? "重新检查连接" : "Check connections again"}
        </button>
      )}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            void query.refetch();
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {zh ? "管理角色连接" : "Manage role connection"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "完成连接后关闭此窗口，将重新检查角色依赖。"
                : "Close this window after connecting to recheck the role's requirements."}
            </DialogDescription>
          </DialogHeader>
          {target && (
            <Suspense fallback={<p>{zh ? "加载中…" : "Loading…"}</p>}>
              <ConnectionManager
                searchQuery={target}
                source="connector"
                showToolbar={false}
                requiredCapabilityIds={[target]}
                compact
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
