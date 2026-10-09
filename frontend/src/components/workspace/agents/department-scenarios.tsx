import { useEffect, useState } from "react";
import { Users, ArrowRight, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { listAgents } from "@/core/agents/api";
import type { Agent } from "@/core/agents/types";
import { writeTaskCollaboratorPreset, taskCollaboratorRouteForLeader } from "@/core/collaboration/task-collaborator-preset";
import { canonicalAgentId } from "@/core/agents/aliases";
import { createTeam, writePreferredTeam, dispatchTeamUpdated } from "@/core/teams/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AgentAvatar } from "@/components/workspace/agent-avatar";
import { Button } from "@/components/ui/button";

type DepartmentScenario = { id: string; title: string; roles: string[][]; flow: string; output: string };

export const DEPARTMENT_SCENARIOS: DepartmentScenario[] = [
  { id: "ai", title: "AI 事业部 · 产品孵化", roles: [["twin_ai_product_manager", "AI 产品"], ["twin_ai_engineer", "AI 工程"], ["twin_user_researcher", "用户研究"], ["twin_test_engineer", "测试"]], flow: "用户研究 → 产品方案 → 技术验证 → 测试评估", output: "需求说明、验证计划、测试报告" },
  { id: "software", title: "软件事业部 · 版本交付", roles: [["twin_project", "项目管理"], ["coder", "软件开发"], ["twin_android_system_engineer", "Android 系统"], ["twin_test_engineer", "测试"]], flow: "需求拆解 → 开发实现 → 系统联调 → 发布验收", output: "版本计划、实现记录、验收清单" },
  { id: "hardware", title: "硬件产品 · 研发评审", roles: [["twin_hw_product", "硬件产品"], ["twin_industrial_design", "工业设计"], ["twin_structural_engineer", "结构工程"], ["twin_optical", "光学工程"], ["twin_quality", "质量"]], flow: "产品定义 → 外观与结构 → 光学评审 → 质量验证", output: "产品规格、设计评审、验证计划" },
  { id: "commerce", title: "硬件电商 · 新品上市", roles: [["ecommerce_mind", "电商运营"], ["echo_noah", "市场研究"], ["vibe_selling", "内容策划"], ["twin_supply_chain", "供应链"]], flow: "市场分析 → 商品与内容策划 → 备货协作 → 上市复盘", output: "上市方案、内容清单、备货与复盘指标" },
  { id: "overseas", title: "海外事业部 · 市场拓展", roles: [["twin_sales", "销售商务"], ["twin_product", "产品"], ["twin_operations", "运营"], ["twin_supply_chain", "供应链"], ["twin_finance", "财务"]], flow: "市场定位 → 产品本地化 → 渠道计划 → 交付与费用评估", output: "区域拓展方案、交付计划、预算草案" },
  { id: "supply", title: "供应链支持 · 质量闭环", roles: [["twin_supply_chain", "供应链"], ["twin_procurement_manager_buyer", "采购"], ["twin_supplier_quality_expert", "供应商质量"], ["twin_quality", "品质工程"]], flow: "异常归类 → 供应商分析 → 采购交付协调 → 整改验证", output: "异常台账、8D 草案、交付与整改计划" },
  { id: "support", title: "综合支持 · 经营协同", roles: [["twin_hr", "人力"], ["twin_finance", "财务"], ["twin_legal", "法务"], ["twin_operations", "运营"]], flow: "业务需求 → 人力与预算 → 合规审查 → 执行跟踪", output: "协作计划、预算草案、合规与行动清单" },
];
export function resolveDepartment(scenario: typeof DEPARTMENT_SCENARIOS[number], agents: Agent[]) {
  return { members: scenario.roles.map(([id]) => agents.find(a => canonicalAgentId(a.name) === canonicalAgentId(id!))), missing: scenario.roles.filter(([id]) => !agents.some(a => canonicalAgentId(a.name) === canonicalAgentId(id!))).map(([,name]) => name) };
}
type AdditionalScenario = DepartmentScenario;
export function DepartmentScenarios({ additional = [] }: { additional?: AdditionalScenario[] }) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    listAgents({ signal: controller.signal }).then(items => { if (!controller.signal.aborted) setAgents(items); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const [draft, setDraft] = useState<DepartmentScenario | null>(null);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leaderId, setLeaderId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const launch = (scenario: DepartmentScenario) => {
    const members = resolveDepartment(scenario, agents).members.filter((a): a is Agent => Boolean(a));
    setMemberSearch(""); setDraft(scenario); setName(scenario.title); setSaveError("");
    setMemberIds(members.map(a => a.name)); setLeaderId(members[0]?.name ?? "");
  };
  const save = async () => {
    if (saving || !name.trim() || !memberIds.length || !memberIds.includes(leaderId)) return;
    setSaving(true); setSaveError("");
    try {
      const members = agents.filter(a => memberIds.includes(a.name));
      const team = await createTeam({ name: name.trim(), members, leaderId });
      writePreferredTeam(team); dispatchTeamUpdated(team);
      window.dispatchEvent(new Event("echo:teams-refresh"));
      writeTaskCollaboratorPreset({ leaderId, collaboratorIds: memberIds, mode: "cluster", label: name.trim(), openPicker: false });
      setDraft(null);
      const route = team.thread_id ? `/workspace/realtime/${encodeURIComponent(team.thread_id)}` : taskCollaboratorRouteForLeader(leaderId);
      navigate(`${route}${route.includes("?") ? "&" : "?"}welcome_team=${encodeURIComponent(team.id)}`);
    } catch {
      setSaveError("团队创建失败，请重试。你的成员选择已保留。");
    } finally { setSaving(false); }
  };
  const scenarios = [...DEPARTMENT_SCENARIOS, ...additional];
  return <section aria-label="精选场景" className="space-y-2">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">精选场景</h3><span className="text-xs text-muted-foreground">按案例创建团队 · 成员可调整</span></div>
    {error && <Button variant="ghost" onClick={() => setAttempt(n => n + 1)}><RefreshCw className="size-4" />角色加载失败，重试</Button>}
    <div id="featured-scenario-list" className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{(expanded ? scenarios : scenarios.slice(0, 6)).map(scenario => {
      const { missing } = resolveDepartment(scenario, agents);
      const status = external ? `${scenario.roles.length} 人` : loading ? "加载中" : `${scenario.roles.length} 个建议岗位`;
      const details = `${scenario.title}\n${scenario.flow}\n岗位：${scenario.roles.map(([,name]) => name).join("、")}${scenario.output ? `\n交付：${scenario.output}` : ""}${missing.length && !external ? `\n待补：${missing.join("、")}` : ""}`;
      return <button key={scenario.id} title={details} aria-label={`启动部门场景：${scenario.title}`} disabled={external ? !scenario.roles.length : loading || error} onClick={() => "onLaunch" in scenario && typeof scenario.onLaunch === "function" ? scenario.onLaunch() : launch(scenario)} className="group flex h-10 min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        <Users className="size-4 shrink-0 text-violet-500" /><span className="min-w-0 flex-1 truncate text-xs font-medium">{scenario.title}</span><span className="shrink-0 text-xs text-muted-foreground">{status}</span><ArrowRight className="size-3 shrink-0 text-muted-foreground" />
      </button>;
    })}</div>
    {scenarios.length > 6 && <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={expanded} aria-controls="featured-scenario-list" onClick={() => setExpanded(value => !value)}>{expanded ? "收起场景" : `展开全部 ${scenarios.length} 个场景`}</button>}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !saving) setDraft(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>创建团队</DialogTitle><DialogDescription>案例提供初始成员，你可以调整成员与队长。具体任务在建团后讨论。</DialogDescription></DialogHeader>
        <label className="space-y-1 text-sm">团队名称<Input aria-label="团队名称" value={name} disabled={saving} onChange={e => setName(e.target.value)} /></label>
        {draft && resolveDepartment(draft, agents).missing.length > 0 && <p className="text-xs text-muted-foreground">案例中未安装的岗位：{resolveDepartment(draft, agents).missing.join("、")}。可选择已有成员替代。</p>}
        <Input aria-label="搜索成员" placeholder="搜索成员姓名或能力" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
        <p className="text-xs text-muted-foreground">已选择 {memberIds.length} 位成员</p>
        <div className="max-h-64 overflow-auto space-y-1" aria-label="团队成员">{agents.filter(agent => !memberSearch.trim() || `${agent.name} ${agent.display_name || ""} ${agent.description || ""}`.toLowerCase().includes(memberSearch.trim().toLowerCase())).map(agent => <label key={agent.name} className="flex items-center gap-2 rounded p-2 hover:bg-muted">
          <input type="checkbox" checked={memberIds.includes(agent.name)} disabled={saving} onChange={e => {
            const next = e.target.checked ? [...memberIds, agent.name] : memberIds.filter(id => id !== agent.name);
            setMemberIds(next); if (!next.includes(leaderId)) setLeaderId(next[0] ?? "");
          }} /><AgentAvatar agent={agent} /><span className="text-sm">{agent.display_name || agent.name}</span>
        </label>)}</div>
        <label className="text-sm">队长<select aria-label="队长" className="ml-2 rounded border bg-background p-1" value={leaderId} disabled={saving} onChange={e => setLeaderId(e.target.value)}><option value="" disabled>选择队长</option>{agents.filter(a => memberIds.includes(a.name)).map(a => <option key={a.name} value={a.name}>{a.display_name || a.name}</option>)}</select></label>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>取消</Button><Button disabled={saving || !name.trim() || !memberIds.length || !leaderId} onClick={() => void save()}>{saving ? "创建中…" : "创建团队"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
