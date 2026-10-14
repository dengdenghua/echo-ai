import { useQuery } from "@tanstack/react-query";
import { fetchRoleRegistration } from "@/core/agents/readiness";
import { useI18n } from "@/core/i18n/hooks";
import { useState } from "react";
import { RoleConnections } from "./role-connections";

export function RoleReadiness({
  agentId,
  onConfigure,
}: {
  agentId: string;
  onConfigure: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: ["agents", "registration", agentId],
    queryFn: ({ signal }) => fetchRoleRegistration(agentId, signal),
    staleTime: 0,
    retry: false,
  });
  const data = query.data;
  const issues =
    data?.checks.filter((item) => item.status !== "registered") ?? [];
  const title = query.isFetching
    ? zh
      ? "正在检查角色技能…"
      : "Checking role skills…"
    : query.isError || !data || data.status === "unknown"
      ? zh
        ? "技能状态暂未确认"
        : "Skill status unconfirmed"
      : data.status === "needs_attention"
        ? zh
          ? "部分技能需要处理"
          : "Some skills need attention"
        : data.checks.length
          ? zh
            ? "已配置技能注册正常"
            : "Configured skills are registered"
          : zh
            ? "未配置额外技能"
            : "No additional skills configured";
  const labels = {
    missing: zh ? "未注册" : "Not registered",
    disabled: zh ? "已停用" : "Disabled",
    unknown: zh ? "待确认" : "Unconfirmed",
    registered: zh ? "已注册" : "Registered",
  };
  return (
    <details
      className="rounded-lg border border-border/60 px-3 py-2 text-ui-caption"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer" aria-live="polite">
        {title}
        {!!(
          data?.dependencies?.connectors.length ||
          data?.dependencies?.mcp_servers.length
        ) && (
          <span className="ml-2 text-muted-foreground">
            {zh ? "· 含连接依赖" : "· Connections required"}
          </span>
        )}
      </summary>
      <div className="mt-2 space-y-2">
        {!query.isError && issues.length > 0 && (
          <ul
            className="max-h-36 space-y-1 overflow-y-auto"
            aria-label={zh ? "技能检查结果" : "Skill check results"}
          >
            {issues.map((item) => (
              <li
                key={item.name}
                className="flex flex-wrap justify-between gap-2"
              >
                <span className="break-all">{item.name}</span>
                <span className="text-muted-foreground">
                  {labels[item.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground">
          {query.isError
            ? zh
              ? "暂时无法读取运行状态，请重新检查。"
              : "Runtime status could not be read. Please check again."
            : zh
              ? "这里只检查技能注册与启用状态；模型连接、工具授权和任务执行结果仍需实际验证。"
              : "This checks skill registration and enablement only. Model access, tool authorization and task execution still need verification."}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            className="underline underline-offset-4 disabled:opacity-50"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {zh ? "重新检查" : "Check again"}
          </button>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={onConfigure}
          >
            {zh ? "管理技能" : "Manage skills"}
          </button>
        </div>
        {expanded &&
          !query.isError &&
          data?.dependencies &&
          (data.dependencies.connectors.length > 0 ||
            data.dependencies.mcp_servers.length > 0) && (
            <RoleConnections
              key={JSON.stringify([agentId, query.data.dependencies])}
              agentId={agentId}
              connectors={data.dependencies.connectors}
              mcpServers={data.dependencies.mcp_servers}
            />
          )}
      </div>
    </details>
  );
}
