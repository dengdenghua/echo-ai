import { useAgents } from "@/core/agents/hooks";
import { AgentAvatar } from "@/components/workspace/agent-avatar";
import { Button } from "@/components/ui/button";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { builtinPersonaDisplayName } from "@/core/agents/persona-display";

/** Use the same live roster as the conversation member picker, not marketplace flags. */
export function LocalAgentList({ queries = [] }: { queries?: string[] }) {
  const { agents, isLoading, error, refetch } = useAgents();
  const visible = agents.filter(agent => queries.every(query =>
    `${builtinPersonaDisplayName(agent.name) || agent.display_name || agent.name} ${agent.name} ${agent.description}`
      .toLowerCase().includes(query.trim().toLowerCase()),
  ));
  if (isLoading) return <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载本地角色…</p>;
  if (error) return <div role="alert" className="py-6 text-sm">本地角色加载失败<Button variant="ghost" onClick={() => void refetch()}>重试</Button></div>;
  return <section aria-label="本地已添加角色" className="space-y-3">
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>本地可用 · {agents.length} 位角色（含内置与已导入角色）</span>
      <Button variant="ghost" size="sm" onClick={() => void refetch()}>刷新</Button>
    </div>
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {visible.map(agent => <a key={agent.name} href={`#${taskWorkspaceRoute({ agentId: agent.name })}`} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/50">
        <AgentAvatar agent={agent} className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{builtinPersonaDisplayName(agent.name) || agent.display_name || agent.name}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground" title={agent.description}>{agent.description}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">发起对话</span>
      </a>)}
    </div>
    {!visible.length && <p className="py-10 text-center text-sm text-muted-foreground">{agents.length ? "没有匹配的本地角色，请调整搜索词。" : "暂无本地可用角色"}</p>}
  </section>;
}
