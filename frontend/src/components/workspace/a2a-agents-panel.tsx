import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  GlobeIcon,
  Loader2Icon,
  NetworkIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { swallow } from "@/core/utils/log";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { PublishedRolesPanel } from "./published-roles-panel";

import { AgentInfoSections } from "./a2a-agent-info";
import { AgentCard, EmptyState } from "./a2a-agent-list";
import { TaskHistoryList, TaskResultView } from "./a2a-agent-tasks";
import type {
  RemoteAgent,
  RemoteTaskRecord,
  TaskResult,
} from "./a2a-agents-types";

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const api = {
  async listAgents(): Promise<{ agents: RemoteAgent[]; count: number }> {
    const res = await fetch(`${getBackendBaseURL()}/api/a2a/agents`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list agents: ${res.statusText}`);
    return res.json();
  },

  async registerAgent(url: string, bearerToken?: string): Promise<RemoteAgent> {
    const res = await fetch(`${getBackendBaseURL()}/api/a2a/agents/register`, {
      method: "POST",
      headers: jsonAuthHeaders(),
      body: JSON.stringify({
        url,
        ...(bearerToken ? { bearer_token: bearerToken } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Registration failed: ${res.statusText}`);
    }
    return res.json();
  },

  async unregisterAgent(agentId: string): Promise<void> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/agents/${agentId}`,
      { method: "DELETE", headers: authHeaders() },
    );
    if (!res.ok) throw new Error(`Unregister failed: ${res.statusText}`);
  },

  async healthCheck(
    agentId: string,
  ): Promise<{ healthy: boolean; status: string; error?: string }> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/agents/${agentId}/health`,
      { method: "POST", headers: jsonAuthHeaders() },
    );
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return res.json();
  },

  async sendTask(agentId: string, text: string): Promise<TaskResult> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/agents/${agentId}/send`,
      {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          text,
          stream: false,
          local_task_id: `web_${crypto.randomUUID()}`,
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Send failed: ${res.statusText}`);
    }
    return res.json();
  },

  async listTasks(agentId: string): Promise<RemoteTaskRecord[]> {
    const query = new URLSearchParams({ agent_id: agentId, limit: "20" });
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/tasks?${query.toString()}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to list tasks: ${res.statusText}`);
    const payload = await res.json();
    return payload.tasks ?? [];
  },

  async refreshTask(localTaskId: string): Promise<RemoteTaskRecord> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/tasks/${encodeURIComponent(localTaskId)}/refresh`,
      { method: "POST", headers: jsonAuthHeaders() },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Refresh failed: ${res.statusText}`);
    }
    return res.json();
  },

  async cancelTask(localTaskId: string): Promise<RemoteTaskRecord> {
    const res = await fetch(
      `${getBackendBaseURL()}/api/a2a/tasks/${encodeURIComponent(localTaskId)}/cancel`,
      { method: "POST", headers: jsonAuthHeaders() },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Cancel failed: ${res.statusText}`);
    }
    return res.json();
  },
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function A2AAgentsPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listAgents();
      setAgents(data.agents);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
    const timer = setInterval(() => void fetchAgents(), 30000);
    return () => clearInterval(timer);
  }, [fetchAgents]);

  const selected = useMemo(
    () => agents.find((a) => a.agent_id === selectedAgent) ?? null,
    [agents, selectedAgent],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <NetworkIcon className="size-4" />
          {t.a2a.title}
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                onClick={fetchAgents}
                aria-label={t.a2a.refresh}
                disabled={loading}
              >
                <RefreshCwIcon
                  className={cn("size-3.5", loading && "animate-spin")}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.a2a.refresh}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
                onClick={() => setShowRegister(!showRegister)}
                aria-label={
                  showRegister ? t.common.cancel : t.a2a.registerAgent
                }
              >
                {showRegister ? (
                  <XIcon className="size-3.5" />
                ) : (
                  <PlusIcon className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {showRegister ? t.common.cancel : t.a2a.registerAgent}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <PublishedRolesPanel />
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">委派给对方角色，由对方选择执行引擎。Codex、OpenCode 等直连条目属于专用执行器。</p>
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircleIcon className="size-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Register form */}
      {showRegister && (
        <RegisterForm
          onRegistered={() => {
            setShowRegister(false);
            void fetchAgents();
          }}
          onCancel={() => setShowRegister(false)}
        />
      )}

      {/* Content */}
      {selected ? (
        <AgentDetailView
          agent={selected}
          onBack={() => setSelectedAgent(null)}
          onRefresh={fetchAgents}
        />
      ) : agents.length === 0 ? (
        <EmptyState
          onRegister={() => setShowRegister(true)}
          showAction={!showRegister}
        />
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.agent_id}
              agent={agent}
              onClick={() => setSelectedAgent(agent.agent_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register form
// ---------------------------------------------------------------------------

function RegisterForm({
  onRegistered,
  onCancel: _onCancel,
}: {
  onRegistered: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setRegistering(true);
    setError(null);
    try {
      await api.registerAgent(url.trim(), bearerToken.trim() || undefined);
      onRegistered();
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-b px-4 py-3">
      <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
        {t.a2a.remoteAgentUrl}
      </label>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://agent.example.com"
          className="border-input bg-background flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-info"
          disabled={registering}
          autoFocus
        />
        <button
          type="submit"
          disabled={!url.trim() || registering}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {registering ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <GlobeIcon className="size-3" />
          )}
          {t.a2a.connect}
        </button>
      </div>
      <label className="mt-2 block text-xs text-muted-foreground">
        访问凭证（受邀热点需要）
        <input
          type="password"
          autoComplete="off"
          value={bearerToken}
          onChange={(e) => setBearerToken(e.target.value)}
          disabled={registering}
          className="mt-1 block w-full rounded border bg-background px-3 py-1.5"
        />
      </label>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Agent detail view
// ---------------------------------------------------------------------------

function AgentDetailView({
  agent,
  onBack,
  onRefresh,
}: {
  agent: RemoteAgent;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [healthResult, setHealthResult] = useState<{
    healthy: boolean;
    error?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [sending, setSending] = useState(false);
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<RemoteTaskRecord[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskAction, setTaskAction] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      setTasks(await api.listTasks(agent.agent_id));
    } catch (err) {
      swallow(err);
      setTaskError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setTasksLoading(false);
    }
  }, [agent.agent_id]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!sending) return;
    const timer = setInterval(() => void fetchTasks(), 2000);
    return () => clearInterval(timer);
  }, [sending, fetchTasks]);

  const handleHealthCheck = async () => {
    setChecking(true);
    setHealthResult(null);
    try {
      const result = await api.healthCheck(agent.agent_id);
      setHealthResult(result);
    } catch (err) {
      swallow(err);
      setHealthResult({
        healthy: false,
        error: err instanceof Error ? err.message : "Check failed",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.unregisterAgent(agent.agent_id);
      onRefresh();
      onBack();
    } catch (e) {
      swallow(e);
      setDeleting(false);
    }
  };

  const handleSendTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskText.trim()) return;

    setSending(true);
    setTaskResult(null);
    setTaskError(null);
    try {
      const result = await api.sendTask(agent.agent_id, taskText.trim());
      setTaskResult(result);
      setTaskText("");
      await fetchTasks();
    } catch (err) {
      swallow(err);
      setTaskError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handleTaskAction = async (
    localTaskId: string,
    action: "refresh" | "cancel",
  ) => {
    setTaskAction(`${action}:${localTaskId}`);
    setTaskError(null);
    try {
      if (action === "refresh") await api.refreshTask(localTaskId);
      else await api.cancelTask(localTaskId);
      await fetchTasks();
    } catch (err) {
      swallow(err);
      setTaskError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setTaskAction(null);
    }
  };

  const isActive = agent.status === "active";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t.common.back}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon className="size-4 rotate-180" />
        </button>
        <div
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            isActive ? "bg-success/10" : "bg-destructive/10",
          )}
        >
          {isActive ? (
            <WifiIcon className="size-3.5 text-success" />
          ) : (
            <WifiOffIcon className="size-3.5 text-destructive" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold">{agent.name}</span>
          <span className="text-muted-foreground ml-1.5 text-xs">
            v{agent.version}
          </span>
        </div>
      </div>

      <AgentInfoSections agent={agent} />

      {/* Actions */}
      <div className="border-b px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleHealthCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {checking ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            {t.a2a.testConnection}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50 dark:hover:bg-destructive/20"
          >
            {deleting ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <Trash2Icon className="size-3" />
            )}
            {t.a2a.remove}
          </button>
        </div>

        {/* Health check result */}
        {healthResult && (
          <div
            className={cn(
              "mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
              healthResult.healthy
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {healthResult.healthy ? (
              <CheckCircle2Icon className="size-3.5" />
            ) : (
              <AlertCircleIcon className="size-3.5" />
            )}
            {healthResult.healthy
              ? t.a2a.connectionSuccessful
              : healthResult.error || t.a2a.connectionFailed}
          </div>
        )}
      </div>

      {/* Send task */}
      <div className="px-4 py-3">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {t.a2a.sendTask}
        </span>
        <form onSubmit={handleSendTask} className="mt-2 flex gap-2">
          <input
            type="text"
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            placeholder={t.a2a.sendTaskPlaceholder}
            className="border-input bg-background flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-info"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!taskText.trim() || sending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : (
              <SendIcon className="size-3" />
            )}
            {t.a2a.send}
          </button>
        </form>

        {/* Task error */}
        {taskError && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircleIcon className="size-3.5 shrink-0" />
            {taskError}
          </div>
        )}

        {/* Task result */}
        {taskResult && <TaskResultView taskResult={taskResult} />}
      </div>

      <TaskHistoryList
        tasks={tasks}
        tasksLoading={tasksLoading}
        taskAction={taskAction}
        onRefresh={fetchTasks}
        onSelectResult={setTaskResult}
        onTaskAction={handleTaskAction}
      />
    </div>
  );
}
