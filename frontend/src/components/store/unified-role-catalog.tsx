import { useMemo, useState } from 'react';
import { useAgents } from '@/core/agents/hooks';
import { mergeProfessions } from '@/core/agents/profession-catalog';
import type { CloudExpertAgent } from '@/core/agents/agent-world-api';
import { taskWorkspaceRoute } from '@/core/router/task-workspace-route';
import { AgentAvatar } from '@/components/workspace/agent-avatar';
import { Button } from '@/components/ui/button';
import { deleteAgent } from '@/core/agents/api';
import { PixelAgentAvatar } from './pixel-agent-avatar';
import { employeeSetupRoute } from './employee-blueprints';
import { mergeRoleCatalog } from './role-catalog';
import { getBackendBaseURL } from '@/core/config';
import { authHeaders } from '@/core/auth/api';
import { useEffect } from 'react';

export function UnifiedRoleCatalog({ experts, searchQuery, loading, error, retry, onDetail, onAdd }: {
  experts: CloudExpertAgent[]; searchQuery: string; loading: boolean; error: string | null; retry: () => void;
  onDetail: (expert: CloudExpertAgent) => void; onAdd: (expert: CloudExpertAgent) => void;
}) {
  const local = useAgents();
  const [echoCatalog, setEchoCatalog] = useState<CloudExpertAgent[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${getBackendBaseURL()}/api/agent-market/echo/catalog`, { headers: authHeaders(), signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ agents?: Array<{ id: string; name: string; description: string; category: string; expert_type: string }> }> : { agents: [] })
      .then(payload => setEchoCatalog((payload.agents ?? []).map(item => ({ id: item.id, name: item.id, display_name: item.name, description: item.description, author: 'Echo', category: item.category, tags: [], icon: '🧩', is_team: item.expert_type === 'team', source: 'echo-catalog' }))))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(48);
  const entries = useMemo(() => mergeRoleCatalog(local.agents, [...experts, ...echoCatalog], mergeProfessions(local.agents)), [local.agents, experts, echoCatalog]);
  const filtered = entries.filter(entry => (filter !== 'installed' || !!entry.local) && (!['employee', 'team'].includes(filter) || entry.kind === filter) && `${entry.title} ${entry.description} ${entry.id}`.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  return <section className="space-y-3" aria-label="统一角色目录">
    <div className="flex flex-wrap gap-1" aria-label="角色分类">
      {[['all', '全部'], ['installed', `已添加 ${local.agents.length}`], ['employee', '数字员工'], ['team', '专家团']].map(([id, label]) => <Button key={id} size="sm" variant={filter === id ? 'secondary' : 'ghost'} aria-pressed={filter === id} onClick={() => { setFilter(id!); setLimit(48); }}>{label}</Button>)}
    </div>
    <p className="text-xs text-muted-foreground">已添加即本机已有角色。未添加的专家按需获取，数字员工按岗位配置添加。</p>
    {local.error && <p role="alert">本机列表加载失败<Button variant="ghost" onClick={() => void local.refetch()}>重试</Button></p>}
    {filter !== 'installed' && error && <p role="alert">专家目录加载失败，本机角色仍可使用。<Button variant="ghost" onClick={retry}>重试目录</Button></p>}
    {(local.isLoading || (filter !== 'installed' && loading)) && <p role="status" className="text-xs text-muted-foreground">正在加载角色目录…</p>}
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
      {filtered.slice(0, limit).map(entry => <article key={entry.id} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/50">
        {entry.local ? <AgentAvatar agent={entry.local} className="size-9" /> : <PixelAgentAvatar id={entry.id} name={entry.title} team={entry.kind === 'team'} />}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={entry.title}>{entry.title}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground" title={entry.description}>{entry.description}</span>
          <span className="text-xs text-muted-foreground">{entry.local ? '已添加' : entry.profession ? '岗位模板' : '未添加'}</span>
        </div>
        {entry.local ? <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" asChild><a href={`#${taskWorkspaceRoute({ agentId: entry.local.name })}`}>对话</a></Button>{!['echo','eve','kane','raven','luna','shion','noah','zero','leon'].includes(entry.local.name) && <Button variant="ghost" size="sm" onClick={async () => { if (!window.confirm(`移除${entry.title}？`)) return; await deleteAgent(entry.local!.name); window.location.reload(); }}>移除</Button>}</div> : entry.cloud ? <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" onClick={() => onDetail(entry.cloud!)}>详情</Button><Button variant="ghost" size="sm" onClick={() => onAdd(entry.cloud!)}>添加</Button></div> : entry.profession ? <Button variant="ghost" size="sm" asChild><a href={`#${employeeSetupRoute(entry.profession)}`}>添加</a></Button> : null}
      </article>)}
    </div>
    {filtered.length > limit && <Button variant="ghost" onClick={() => setLimit(value => value + 48)}>加载更多（{limit}/{filtered.length}）</Button>}
    {!filtered.length && !local.isLoading && !local.error && !(loading && filter !== 'installed') && <p className="py-10 text-center text-sm text-muted-foreground">{searchQuery ? '没有匹配的角色' : filter === 'installed' ? '暂无已添加角色，可从全部目录按需添加' : '暂无匹配角色'}</p>}
  </section>;
}
