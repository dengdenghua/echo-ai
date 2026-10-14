/**
 * HUB 智能体: the agent library, cloud roles, experts and teams.
 */
import { DepartmentScenarios } from "./department-scenarios";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
  StoreIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { installAgent } from "@/core/agents/agent-world-api";
import type { AgentWorldAgent } from "@/core/agents/types";
import { isPrimaryPersonaAgentId } from "@/core/agents/persona-policy";
import { AgentCard } from "./agent-card";
import { AgentWorldCard } from "./agent-world-card";
import { SmartTeamDialog } from "./smart-team-dialog";
import {
  AGENT_CATEGORY_FILTERS,
  LOCAL_AGENT_IDS,
  LOCAL_AGENT_RANK,
  worldAgentToAgent,
  type AgentCategoryFilter,
} from "./agent-world-data";

export function AgentsTab({
  agents,
  filteredAgents,
  loading,
  loadError,
  activeCategory,
  onCategoryChange,
  onSelectAgent,
  onInstallChange,
  onRetry,
  onCreateAgent,
  showManagementActions = true,
  sceneOnly = false,
}: {
  agents: AgentWorldAgent[];
  filteredAgents: AgentWorldAgent[];
  loading: boolean;
  loadError: boolean;
  activeCategory: AgentCategoryFilter;
  onCategoryChange: (category: AgentCategoryFilter) => void;
  onSelectAgent: (agent: AgentWorldAgent) => void;
  onInstallChange: () => void;
  onRetry: () => void;
  onCreateAgent: () => void;
  showManagementActions?: boolean;
  sceneOnly?: boolean;
}) {
  const { t } = useI18n();
  const [installingAll, setInstallingAll] = useState(false);
  const [confirmInstallAll, setConfirmInstallAll] = useState(false);
  const [smartTeamOpen, setSmartTeamOpen] = useState(false);
  const visibleAgents = useMemo(
    () =>
      filteredAgents.slice().sort((a, b) => {
        if (a.is_installed !== b.is_installed) {
          return a.is_installed ? -1 : 1;
        }
        const rankA = LOCAL_AGENT_RANK.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = LOCAL_AGENT_RANK.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return a.display_name.localeCompare(b.display_name);
      }),
    [filteredAgents],
  );
  const installedCount = useMemo(
    () => agents.filter((agent) => agent.is_installed).length,
    [agents],
  );
  const installableAgents = useMemo(
    () => visibleAgents.filter((agent) => !agent.is_installed),
    [visibleAgents],
  );
  const installableCount = agents.length - installedCount;
  const featuredScenarios = useMemo(
    () =>
      [
        {
          id: "white-ghost",
          title: "白幽灵行动组",
          description: "完整主角团协同，适合复杂任务、跨工具执行与现场决策。",
          memberIds: ["eve", "kane", "raven", "luna", "shion", "noah", "zero"],
          domains: ["eve", "automation"],
          accent: "from-muted to-background",
        },
        {
          id: "product-lab",
          title: "产品研发冲刺",
          description: "从需求拆解、架构实现到桌面验收，组成一支小型交付团队。",
          memberIds: ["kane", "raven", "eve"],
          domains: ["coding", "automation"],
          accent: "from-muted to-background",
        },
        {
          id: "investment-room",
          title: "投研决策室",
          description:
            "聚合市场研究、信息验证与商业判断，形成可执行的投资结论。",
          memberIds: ["noah", "eve", "shion"],
          domains: ["research", "finance"],
          accent: "from-muted to-background",
        },
        {
          id: "growth-studio",
          title: "品牌增长工作室",
          description: "把用户洞察、内容创意与商业转化串成一条完整增长链路。",
          memberIds: ["luna", "eve", "shion"],
          domains: ["creative", "ecommerce"],
          accent: "from-muted to-background",
        },
        {
          id: "automation-cell",
          title: "自动化执行中枢",
          description: "代码、桌面和流程三线并行，适合批量操作与长链路任务。",
          memberIds: ["raven", "kane", "zero"],
          domains: ["automation", "coding"],
          accent: "from-muted to-background",
        },
      ]
        .filter(
          (scenario) =>
            activeCategory === "all" ||
            scenario.domains.includes(activeCategory),
        )
        .map((scenario) => ({
          ...scenario,
          members: scenario.memberIds
            .map((id) =>
              agents.find((agent) => agent.id === id || agent.name === id),
            )
            .filter((agent): agent is AgentWorldAgent => Boolean(agent)),
        }))
        .filter((scenario) => scenario.members.length > 0),
    [activeCategory, agents],
  );

  useEffect(() => {
    setConfirmInstallAll(false);
  }, [activeCategory, installableAgents.length]);

  const handleInstallAll = async () => {
    if (installingAll || installableAgents.length === 0) return;
    if (!confirmInstallAll) {
      setConfirmInstallAll(true);
      return;
    }
    setInstallingAll(true);
    let installed = 0;
    let failed = 0;
    for (const agent of installableAgents) {
      try {
        await installAgent(agent.id);
        installed += 1;
      } catch (error) {
        failed += 1;
        swallow(error);
      }
    }
    setInstallingAll(false);
    setConfirmInstallAll(false);
    onInstallChange();
    if (installed > 0) {
      toast.success(
        failed > 0
          ? t.agentWorldUnified.installSuccessWithFailure(installed, failed)
          : t.agentWorldUnified.installSuccess(installed),
      );
    } else if (failed > 0) {
      toast.error(t.agentWorldUnified.installFailed);
    }
  };

  if (loading) {
    if (sceneOnly) {
      return (
        <section aria-label="正在加载精选场景" className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-44 w-[280px] shrink-0 rounded-2xl"
              />
            ))}
          </div>
        </section>
      );
    }
    return (
      <div
        data-testid="agents-loading-skeleton"
        className="space-y-3"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">{t.agentWorldUnified.loadingAgents}</span>
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError && agents.length === 0) {
    if (sceneOnly) {
      return (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-muted/20 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
            <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
            精选场景暂时不可用
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-ui"
            onClick={onRetry}
          >
            {t.agentWorldUnified.retryAgents}
          </Button>
        </div>
      );
    }
    return (
      <section
        role="alert"
        className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-border-subtle bg-gradient-to-b from-muted/20 to-background px-5 py-8 text-center sm:min-h-[360px] sm:px-6 sm:py-10"
      >
        <span className="flex size-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 text-destructive sm:size-12">
          <AlertCircleIcon className="size-5" aria-hidden="true" />
        </span>
        <h2 className="mt-3 max-w-sm text-base font-semibold text-foreground sm:mt-4">
          {t.agentWorldUnified.loadAgentsFailed}
        </h2>
        <div
          className={cn(
            "mt-4 grid w-full max-w-sm gap-2 sm:mt-5 sm:flex sm:w-auto sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center",
            showManagementActions ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          <Button
            type="button"
            className="min-w-0 px-2 text-ui sm:px-4 sm:text-sm"
            onClick={onRetry}
          >
            {t.agentWorldUnified.retryAgents}
          </Button>
          {showManagementActions ? (
            <>
              <Button
                type="button"
                className="min-w-0 px-2 text-ui sm:px-4 sm:text-sm"
                variant="outline"
                onClick={onCreateAgent}
              >
                <PlusIcon className="mr-1.5 hidden size-4 sm:block" />
                {t.agentWorld.newAgent}
              </Button>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      {loadError && (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm md:flex-row md:items-center"
        >
          <span className="flex items-center gap-2 text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            {t.agentWorldUnified.loadAgentsFailed}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onRetry}
          >
            {t.agentWorldUnified.retryAgents}
          </Button>
        </div>
      )}
      {!sceneOnly ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <div
              data-testid="agents-category-scroll"
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 pr-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
              role="group"
              aria-label={t.agentWorldUnified.domainFilterLabel}
            >
              {AGENT_CATEGORY_FILTERS.map((category) => {
                const label = t.agentWorldUnified.domains[category];
                return (
                  <Button
                    key={category}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCategoryChange(category)}
                    aria-pressed={activeCategory === category}
                    className={cn(
                      "h-8 shrink-0 rounded-md px-3 text-ui font-normal text-muted-foreground shadow-none",
                      activeCategory === category &&
                        "bg-muted font-medium text-foreground",
                    )}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>

          {showManagementActions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-ui text-muted-foreground md:justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg border-primary/20 bg-primary/5 px-2.5 text-ui font-medium text-primary shadow-none hover:bg-primary/10"
                onClick={() => setSmartTeamOpen(true)}
              >
                <SparklesIcon className="mr-1.5 size-3.5" />
                智能组队
              </Button>
              <span className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5">
                <span className="text-muted-foreground/80">
                  {t.agentWorldUnified.installedLabel}
                </span>
                <span className="ml-1 font-medium text-foreground">
                  {installedCount}
                </span>
              </span>
              <span className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5">
                <span className="text-muted-foreground/80">
                  {t.agentWorldUnified.installableLabel}
                </span>
                <span className="ml-1 font-medium text-foreground">
                  {Math.max(0, installableCount)}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg border border-border bg-background px-2.5 text-ui font-medium text-muted-foreground shadow-none hover:bg-muted/45 hover:text-foreground"
                disabled={installingAll || installableAgents.length === 0}
                onClick={() => void handleInstallAll()}
                title={
                  confirmInstallAll
                    ? t.agentWorldUnified.installAllConfirmTitle(
                        installableAgents.length,
                      )
                    : t.agentWorldUnified.installAllConfirmHint
                }
              >
                {installingAll && (
                  <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {confirmInstallAll
                  ? t.agentWorldUnified.installAllConfirmButton(
                      installableAgents.length,
                    )
                  : t.agentWorldUnified.installAllButton}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    className="h-8 rounded-lg px-2.5 shadow-none"
                  >
                    <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                    {t.agentWorldUnified.addAgentButton}
                    <ChevronDownIcon className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={onCreateAgent}>
                    <PlusIcon className="h-4 w-4" />
                    {t.agentWorld.newAgent}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      ) : null}

      <SmartTeamDialog
        open={smartTeamOpen}
        onOpenChange={setSmartTeamOpen}
        agents={agents}
        onInstallChange={onInstallChange}
      />

      <DepartmentScenarios
        additional={featuredScenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          roles: scenario.members.map((member) => [
            member.name,
            member.display_name,
          ]),
          flow: scenario.description,
          output: "",
        }))}
      />

      {!sceneOnly ? (
        <>
          <div className="flex items-center justify-between pt-1">
            <h3 className="text-sm font-semibold text-foreground">
              全部智能体
            </h3>
            <span className="text-ui-caption text-muted-foreground">
              {visibleAgents.length} 位
            </span>
          </div>

          {visibleAgents.length > 0 ? (
            <div
              data-testid="agents-card-grid"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4"
            >
              {visibleAgents.map((agent) =>
                agent.is_installed ? (
                  <AgentCard
                    key={agent.id}
                    agent={worldAgentToAgent(agent)}
                    isDefault={
                      agent.is_official || LOCAL_AGENT_IDS.has(agent.id)
                    }
                    isPrimaryIdentity={isPrimaryPersonaAgentId(agent.id)}
                    onSelect={() => onSelectAgent(agent)}
                  />
                ) : (
                  <AgentWorldCard
                    key={agent.id}
                    agent={agent}
                    onSelect={onSelectAgent}
                    onInstallChange={onInstallChange}
                  />
                ),
              )}
            </div>
          ) : (
            <div
              data-testid="agents-empty-state"
              className="flex flex-col items-center py-16"
              role="status"
            >
              <StoreIcon className="text-muted-foreground mb-3 h-10 w-10" />
              <p className="text-muted-foreground text-sm">
                {t.agentWorld.noAgentsFound}
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins Tab (extracted from plugins page, embedded into Hub)
// ---------------------------------------------------------------------------
