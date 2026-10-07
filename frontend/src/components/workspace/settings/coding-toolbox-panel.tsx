import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  GitBranchIcon,
  GitCommitIcon,
  Link2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import {
  executionStorageKey,
  getRemoteExecutionId,
} from "@/core/execution-location";
import { useI18n } from "@/core/i18n/hooks";
import { loadMCPConfig } from "@/core/mcp/api";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { useLocalSettings } from "@/core/settings";
import { listPermissionRules } from "@/core/settings/permissions-api";
import { useActiveProjectRoot } from "@/core/workspace/use-active-project-root";
import { listGitWorktrees } from "@/core/workspace/worktrees";
import { cn } from "@/lib/utils";
import { WorkDirSelector } from "../workdir-selector";
import { WorktreeDialog } from "../worktree-dialog";

type CodingToolboxPanelProps = {
  onOpen?: (target: "tools" | "automationSecurity") => void;
  onOpenTask?: (path: string) => void;
  compact?: boolean;
};

type ServiceHealth = {
  status: string;
  runtime: { version: string; hostApiVersion?: string };
};

async function serviceHealth(signal: AbortSignal): Promise<ServiceHealth> {
  const response = await fetch(`${getBackendBaseURL()}/api/health`, {
    headers: authHeaders(),
    signal,
  });
  if (!response.ok)
    throw new Error(`Echo service unavailable (${response.status})`);
  const data = (await response.json()) as ServiceHealth;
  if (!data.runtime?.version || !data.status)
    throw new Error("Echo service did not report its status");
  return data;
}

export function CodingToolboxPanel({
  onOpen,
  onOpenTask,
  compact = false,
}: CodingToolboxPanelProps) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const navigate = useNavigate();
  const recentProject = useActiveProjectRoot();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const project = selectedProject ?? recentProject;
  const [settings] = useLocalSettings();
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const scope = executionStorageKey("coding-toolbox");
  const health = useQuery({
    queryKey: [scope, "health"],
    queryFn: ({ signal }) => serviceHealth(signal),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const rules = useQuery({
    queryKey: [scope, "rules"],
    queryFn: listPermissionRules,
    staleTime: 30_000,
    retry: false,
  });
  const connections = useQuery({
    queryKey: [scope, "mcp"],
    queryFn: loadMCPConfig,
    staleTime: 30_000,
    retry: false,
  });
  const git = useQuery({
    queryKey: [executionStorageKey("git-worktrees"), project ?? ""],
    queryFn: ({ signal }) => listGitWorktrees(project!, signal),
    enabled: Boolean(project),
    staleTime: 30_000,
    retry: false,
  });
  const checking = zh ? "检查中" : "Checking";
  const unavailable = zh ? "读取失败" : "Unavailable";
  const chooseProject = zh ? "先选择 Git 项目" : "Choose a Git project";
  const enabledConnections = Object.values(
    connections.data?.mcp_servers ?? {},
  ).filter((server) => server.enabled).length;
  const fullAccess = settings.context.permission_mode === "bypassPermissions";
  const localEnvironment =
    fullAccess || settings.context.execution_environment === "local";
  const items = [
    {
      key: "rules",
      label: zh ? "审批规则" : "Approval rules",
      icon: ShieldCheckIcon,
      status: rules.isError
        ? unavailable
        : rules.isPending
          ? checking
          : rules.data?.length
            ? zh
              ? `${rules.data.length} 条自定义规则`
              : `${rules.data.length} custom rules`
            : zh
              ? "默认审批规则"
              : "Default approval rules",
      detail: zh ? "查看与管理工具执行审批" : "Manage tool execution approval",
      error: rules.error,
      action: onOpen ? () => onOpen("automationSecurity") : undefined,
    },
    {
      key: "connections",
      label: zh ? "连接" : "Connections",
      icon: Link2Icon,
      status: connections.isError
        ? unavailable
        : connections.isPending
          ? checking
          : zh
            ? `${enabledConnections} 项启用配置`
            : `${enabledConnections} enabled configurations`,
      detail: zh
        ? "MCP 配置；连接状态在设置中验证"
        : "MCP configuration; verify connectivity in settings",
      error: connections.error,
      action: onOpen ? () => onOpen("tools") : undefined,
    },
    {
      key: "git",
      label: "Git",
      icon: GitCommitIcon,
      status: !project
        ? chooseProject
        : git.isError
          ? unavailable
          : git.isPending
            ? checking
            : zh
              ? "项目已验证"
              : "Repository verified",
      detail:
        git.data?.root ??
        (zh ? "验证当前项目的 Git 仓库" : "Verify the selected Git repository"),
      error: git.error,
      action:
        git.data && !git.isError ? () => setWorktreeOpen(true) : undefined,
    },
    {
      key: "environment",
      label: zh ? "执行环境" : "Environment",
      icon: TerminalSquareIcon,
      status: health.isError
        ? unavailable
        : health.isPending
          ? checking
          : health.data?.status !== "ok"
            ? zh
              ? "服务异常"
              : "Service degraded"
            : zh
              ? "服务在线"
              : "Service online",
      detail: zh
        ? `任务设置：${localEnvironment ? "本机执行" : "沙箱执行"}`
        : `Task setting: ${localEnvironment ? "local execution" : "sandbox execution"}`,
      error: health.error,
      action: onOpen ? () => onOpen("automationSecurity") : undefined,
    },
    {
      key: "worktrees",
      label: "Worktrees",
      icon: GitBranchIcon,
      status: !project
        ? chooseProject
        : git.isError
          ? unavailable
          : git.isPending
            ? checking
            : zh
              ? `${git.data?.worktrees.length ?? 0} 个工作区`
              : `${git.data?.worktrees.length ?? 0} workspaces`,
      detail: zh
        ? "创建隔离目录，在新任务中打开"
        : "Create an isolated workspace and open a task",
      error: git.error,
      action:
        git.data && !git.isError ? () => setWorktreeOpen(true) : undefined,
    },
  ];
  const refreshing = [health, rules, connections, git].some(
    (query) => query.isFetching,
  );
  const refresh = () => {
    void health.refetch();
    void rules.refetch();
    void connections.refetch();
    if (project) void git.refetch();
  };
  return (
    <section
      aria-label={zh ? "编码工具箱" : "Coding toolbox"}
      className={cn(
        compact
          ? "flex w-20 shrink-0 flex-col gap-2 border-r p-2"
          : "space-y-4 rounded-xl border bg-card/70 p-4",
      )}
    >
      {!compact && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">
                {zh ? "编码工具箱" : "Coding toolbox"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {getRemoteExecutionId()
                  ? zh
                    ? "所选远程电脑"
                    : "Selected remote computer"
                  : zh
                    ? "当前 Echo 服务"
                    : "Current Echo service"}
                {health.data && !health.isError
                  ? ` · v${health.data.runtime.version} · API ${health.data.runtime.hostApiVersion ?? "—"}`
                  : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCwIcon
                className={cn("size-3.5", refreshing && "animate-spin")}
              />
              {zh ? "重新检测" : "Refresh"}
            </Button>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{zh ? "项目" : "Project"}</span>
            <WorkDirSelector
              workDir={project ?? ""}
              onWorkDirChange={setSelectedProject}
              variant="muted"
            />
          </div>
        </>
      )}
      <div
        className={cn(
          compact ? "space-y-2" : "grid gap-2 sm:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={!item.action}
            onClick={item.action}
            title={
              item.error instanceof Error ? item.error.message : item.detail
            }
            data-testid={`coding-tool-${item.key}`}
            className={cn(
              "min-w-0 rounded-lg border bg-background/60 p-3 text-left",
              item.action &&
                "transition-colors hover:border-primary/40 hover:bg-primary/5",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <item.icon className="size-4 text-primary" />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <p
              className={cn(
                "mt-2 break-words text-xs",
                item.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {item.status}
            </p>
            {!compact && (
              <p className="mt-1 break-all text-[11px] leading-4 text-muted-foreground">
                {item.detail}
              </p>
            )}
            {!compact && item.error instanceof Error && (
              <p className="mt-1 break-words text-[11px] leading-4 text-destructive">
                {item.error.message}
              </p>
            )}
          </button>
        ))}
      </div>
      <WorktreeDialog
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
        projectPath={project ?? ""}
        onOpenTask={(path) => {
          if (onOpenTask) onOpenTask(path);
          else navigate(taskWorkspaceRoute({ workspacePath: path }));
        }}
      />
    </section>
  );
}
