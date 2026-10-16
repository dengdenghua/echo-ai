import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CircuitBoard,
  Loader2,
  Save,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  useEvolutionOverview,
  useSkillPerformance,
  useEvolutionStory,
} from "@/core/evolution/hooks";
import {
  calculateLevel,
  calculateXP,
  calculateStars,
} from "@/components/workspace/evolution-dashboard/game-data-transformer";
import { AbilityRadarChart } from "@/components/workspace/evolution-dashboard/ability-radar-chart";
import { SkillTree } from "@/components/workspace/evolution-dashboard/skill-tree";
import { GrowthTimeline } from "@/components/workspace/evolution-dashboard/growth-timeline";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAgent, useUpdateAgent } from "@/core/agents/hooks";
import { installAgent } from "@/core/agents/agent-world-api";
import {
  useAgentToolRegistry,
  useArms,
  useCapabilityPermissions,
  useSaveAgentToolRegistry,
} from "@/core/agents/tool-registry-hooks";
import type { AgentWorldAgent } from "@/core/agents/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AgentArmsDialog } from "./agent-arms-dialog";
import { AgentCoreVisual } from "./agent-core-visual";
import {
  buildCharacterProfile,
  buildEvolutionTabData,
  buildRoleProfileNotes,
  type EditableAgentConfig,
  makeCodeName,
  makeUid,
  parseList,
  sameList,
  serializeList,
  uniqueList,
} from "./agent-role-profile-model";
import { RoleReadiness } from "./role-readiness";

interface AgentRoleProfileDialogProps {
  agent: AgentWorldAgent | null;
  agents?: AgentWorldAgent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallChange?: () => void;
  onSelectAgent?: (agent: AgentWorldAgent) => void;
  onCreateAgent?: () => void;
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className="block text-ui font-medium text-foreground">
      {label}
      {hint ? (
        <span className="ml-2 font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function AgentRoleProfileDialog({
  agent,
  agents = [],
  open,
  onOpenChange,
  onInstallChange,
  onSelectAgent,
  onCreateAgent,
}: AgentRoleProfileDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [armsOpen, setArmsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [installingPack, setInstallingPack] = useState(false);
  const [armsInitialTab, setArmsInitialTab] = useState<
    "arms" | "skills" | "permissions" | "routing"
  >("arms");
  const [activeBottomTab, setActiveBottomTab] = useState<
    "overview" | "growth" | "radar" | "skills"
  >("overview");
  const [form, setForm] = useState<EditableAgentConfig>({
    description: "",
    model: "",
    soul: "",
    arms: [],
    extraAffinity: "",
    privateSkills: "",
  });

  const localAgentName = open && agent?.is_installed ? agent.name : null;
  const agentQuery = useAgent(localAgentName);
  const armsQuery = useArms();
  const registryQuery = useAgentToolRegistry(localAgentName);
  const permissionsQuery = useCapabilityPermissions();
  const updateAgent = useUpdateAgent();
  const saveRegistry = useSaveAgentToolRegistry(agent?.name ?? "");

  // Fetch evolution data
  const evolutionQuery = useEvolutionOverview();
  const evolutionData = evolutionQuery.data;
  const skillPerformanceQuery = useSkillPerformance();
  const skillPerformances = skillPerformanceQuery.data;
  const evolutionStoryQuery = useEvolutionStory();
  const evolutionStory = evolutionStoryQuery.data;

  const fullAgent = agentQuery.agent;
  const registry = registryQuery.data;
  const characterProfile = useMemo(
    () => (agent ? buildCharacterProfile(agent, t) : null),
    [agent, t],
  );

  // Transform evolution data for tabs
  const tabData = useMemo(
    () =>
      buildEvolutionTabData(evolutionData, skillPerformances, evolutionStory),
    [evolutionData, skillPerformances, evolutionStory],
  );

  const meta = useMemo(() => {
    if (!agent) return null;
    return {
      codeName: makeCodeName(agent),
      uid: makeUid(agent),
      role: t.agentConfig.categoryRoles[agent.category],
      type: t.agentConfig.categoryTypes[agent.category],
      faction: agent.is_official
        ? t.agentConfig.officialFaction
        : t.agentConfig.authorFaction(agent.author),
    };
  }, [agent, t]);

  const serverState = useMemo<EditableAgentConfig | null>(() => {
    if (!agent) return null;
    const fallbackPrivateSkills =
      agent.private_skills ?? agent.key_skills ?? [];
    return {
      description: fullAgent?.description ?? agent.description ?? "",
      model: fullAgent?.model ?? agent.model ?? "",
      soul: fullAgent?.soul ?? agent.soul ?? "",
      arms: registry?.arms ?? fullAgent?.tool_groups ?? agent.tool_groups ?? [],
      extraAffinity: serializeList(
        registry?.extra_affinity ?? agent.extra_affinity,
      ),
      privateSkills: serializeList(
        registry?.private_skills?.length
          ? registry.private_skills
          : fallbackPrivateSkills,
      ),
    };
  }, [agent, fullAgent, registry]);

  useEffect(() => {
    if (open && serverState) {
      setForm(serverState);
    }
  }, [open, serverState]);

  if (!agent || !meta || !characterProfile) return null;

  const desiredExtraAffinity = parseList(form.extraAffinity);
  const desiredPrivateSkills = parseList(form.privateSkills);
  const agentDirty =
    !!serverState &&
    (form.description !== serverState.description ||
      form.model !== serverState.model ||
      form.soul !== serverState.soul);
  const registryDirty =
    !!serverState &&
    (!sameList(form.arms, serverState.arms) ||
      form.extraAffinity.trim() !== serverState.extraAffinity.trim() ||
      form.privateSkills.trim() !== serverState.privateSkills.trim());
  const isDirty = agentDirty || registryDirty;
  const canAssembleCapabilityPack =
    !agent.is_installed && desiredPrivateSkills.length > 0;
  const isLoading =
    agentQuery.isLoading || armsQuery.isLoading || registryQuery.isLoading;
  const isSaving = updateAgent.isPending || saveRegistry.isPending;
  const desiredArmSet = new Set(form.arms);
  const desiredSkillSet = new Set(desiredPrivateSkills);
  const selectedArmSkillSet = new Set<string>();
  for (const arm of armsQuery.data ?? []) {
    if (!desiredArmSet.has(arm.arm_id)) continue;
    for (const skill of arm.skills) selectedArmSkillSet.add(skill);
  }
  const permissionEffectiveCount =
    permissionsQuery.data?.filter((permission) => {
      if (!permission.enabled) return false;
      if (permission.id === "builtin" || permission.id === "memory") {
        return true;
      }
      return permission.skill_names.some(
        (skill) => selectedArmSkillSet.has(skill) || desiredSkillSet.has(skill),
      );
    }).length ?? 0;
  const permissionTotalCount = permissionsQuery.data?.length ?? 0;
  const permissionSummary = permissionTotalCount
    ? t.armsEditor.permissionEffectiveCount(
        permissionEffectiveCount,
        permissionTotalCount,
      )
    : t.agentConfig.guarded;
  const roleLabel = meta.role ?? agent.category;
  const typeLabel = meta.type ?? agent.category;
  const identityRows = [
    characterProfile.age
      ? [t.agentConfig.characterAgeLabel, characterProfile.age]
      : null,
    characterProfile.temperament
      ? [t.agentConfig.characterTemperamentLabel, characterProfile.temperament]
      : null,
    [typeLabel, characterProfile.currentState || roleLabel],
  ].filter(Boolean) as Array<[string, string]>;
  const profileNotes = buildRoleProfileNotes(agent, t);
  const personaTags = uniqueList([
    roleLabel,
    characterProfile.temperament,
    ...characterProfile.visualKeywords.slice(0, 3),
  ]);
  const sceneTags = uniqueList(profileNotes.bestFor);
  const boundaryTags = uniqueList(profileNotes.boundaries);
  const configActions = [
    {
      id: "profile",
      icon: CircuitBoard,
      label: t.agentConfig.configureProfileAction,
      shortLabel: t.agentConfig.basicTitle,
      metric: `${t.agentConfig.descriptionLabel} / ${t.agentConfig.promptSubtitle}`,
      hint: t.agentConfig.configureProfileHint,
      onClick: () => setProfileOpen(true),
    },
    {
      id: "arms",
      icon: Wrench,
      label: t.agentConfig.configureArmAction,
      shortLabel: "ARM",
      metric: t.agentConfig.armCount(form.arms.length),
      hint: t.agentConfig.configureArmHint,
      onClick: () => openArmsConfig("arms"),
    },
    {
      id: "skills",
      icon: Sparkles,
      label: t.agentConfig.browseSkillWhitelist,
      shortLabel: "Skill",
      metric: t.agentConfig.skillCount(desiredPrivateSkills.length),
      hint: t.agentConfig.configureSkillsHint,
      onClick: () => openArmsConfig("skills"),
    },
    {
      id: "permissions",
      icon: Shield,
      label: t.agentConfig.configurePermissionsAction,
      shortLabel: t.agentConfig.configurePermissionsAction.replace(
        /^调整|^Configure\s+/i,
        "",
      ),
      metric: permissionSummary,
      hint: t.agentConfig.configurePermissionsHint,
      onClick: () => openArmsConfig("permissions"),
    },
  ] as const;
  function openArmsConfig(tab: "arms" | "skills" | "permissions" | "routing") {
    setArmsInitialTab(tab);
    setArmsOpen(true);
  }

  function setField<K extends keyof EditableAgentConfig>(
    key: K,
    value: EditableAgentConfig[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!agent) return;
    try {
      if (agentDirty) {
        await updateAgent.mutateAsync({
          name: agent.name,
          request: {
            description: form.description,
            model: form.model.trim() || null,
            soul: form.soul,
          },
        });
      }
      if (registryDirty) {
        await saveRegistry.mutateAsync({
          arms: form.arms,
          extra_affinity: desiredExtraAffinity,
          private_skills: desiredPrivateSkills,
        });
      }
      toast.success(t.agentConfig.saved);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t.agentConfig.saveFailed(message));
    }
  }

  async function handleAssembleCapabilityPack() {
    if (!agent || installingPack) return;
    setInstallingPack(true);
    try {
      const result = await installAgent(agent.id);
      const assembledSkillCount =
        result.key_skills?.length ??
        result.registered_skills ??
        desiredPrivateSkills.length;
      toast.success(
        assembledSkillCount > 0
          ? t.agentWorld.toastCapabilityPackInstalled(
              agent.display_name,
              assembledSkillCount,
            )
          : t.agentWorld.toastInstalled(agent.display_name),
      );
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      onInstallChange?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    } finally {
      setInstallingPack(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "flex !h-[min(800px,calc(100dvh-2rem))] !w-[min(1180px,calc(100vw-2rem))] !max-w-none flex-col gap-0 overflow-hidden border-border bg-card p-0 text-foreground",
            "data-[state=open]:duration-base",
          )}
          closeLabel={t.common.close}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4 pr-16 sm:px-6 sm:pr-16">
            <DialogTitle className="text-base font-semibold">
              {agent.display_name}
            </DialogTitle>
            <span className="text-ui text-muted-foreground">
              {t.agentConfig.characterFileLabel}
            </span>
            {isDirty && (
              <span className="text-ui-caption text-warning">
                {t.agentConfig.unsaved}
              </span>
            )}
          </header>
          <DialogDescription className="sr-only">
            {t.agentConfig.subtitle}
          </DialogDescription>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="relative grid h-full grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)] md:grid-rows-1 md:overflow-hidden">
              <section className="relative flex min-h-0 flex-col bg-card px-5 py-5 sm:px-6 md:overflow-hidden lg:px-7">
                <div className="min-h-0 flex-none pr-1 [scrollbar-width:thin] md:flex-1 md:overflow-y-auto md:pr-3">
                  <div className="w-full pb-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-ui-caption tracking-normal text-primary">
                        <span className="h-px w-6 bg-primary/70" />
                        {t.agentConfig.characterFileLabel}
                      </div>
                      <h1 className="mt-2 truncate text-3xl font-semibold leading-none text-foreground">
                        {agent.display_name}
                      </h1>
                      <p className="mt-3 text-lg font-medium leading-7 text-primary">
                        {characterProfile.epithet}
                      </p>

                      {/* Evolution Level Display */}
                      {evolutionData &&
                        (() => {
                          const level = calculateLevel(
                            evolutionData.learning_events,
                          );
                          const stars = calculateStars(level);
                          const { progress } = calculateXP(
                            evolutionData.learning_events,
                          );
                          const getStars = (count: number) =>
                            "⭐".repeat(count);
                          const getTitle = (lvl: number) => {
                            if (lvl <= 5) return "新手";
                            if (lvl <= 10) return "学徒";
                            if (lvl <= 20) return "熟手";
                            if (lvl <= 35) return "专家";
                            if (lvl <= 50) return "大师";
                            if (lvl <= 75) return "宗师";
                            return "传奇";
                          };

                          return (
                            <div className="mt-3">
                              <div className="flex items-center gap-2 text-ui-body">
                                <span className="font-semibold text-primary">
                                  Lv.{level}
                                </span>
                                <span className="text-ui-caption">
                                  {getStars(stars)}
                                </span>
                                <span className="text-muted-foreground">
                                  · 🎯 {getTitle(level)}
                                </span>
                              </div>
                              <div className="mt-2">
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all duration-500"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <p className="mt-1 text-ui-caption text-muted-foreground">
                                  {progress}% → Lv.{level + 1}
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border/60 bg-muted/50">
                        {identityRows.map(([label, value]) => (
                          <div
                            key={`${label}-${value}`}
                            className="min-w-0 bg-card px-2.5 py-2"
                          >
                            <div className="truncate text-ui-caption tracking-normal text-muted-foreground">
                              {label}
                            </div>
                            <div className="mt-1 truncate text-ui-caption font-medium leading-4 text-foreground">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 flex items-center gap-2 text-ui-caption tracking-normal text-primary">
                        <span className="h-px w-4 bg-primary/60" />
                        {t.agentConfig.characterBestForLabel}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {sceneTags.map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-primary/22 bg-primary/[0.075] px-2.5 py-1 text-ui-caption leading-5 text-foreground"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 border-l-2 border-primary bg-primary/[0.045] px-4 py-3">
                      <p className="text-base font-medium leading-7 text-foreground">
                        &ldquo;{characterProfile.quote}&rdquo;
                      </p>
                    </div>

                    <div className="mt-6">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-ui-caption tracking-normal text-muted-foreground">
                          <span className="h-px w-4 bg-muted/50" />
                          PERSONA
                        </div>
                        <span className="text-ui-caption tracking-normal text-muted-foreground">
                          {meta.codeName}
                        </span>
                      </div>
                      <p className="text-ui-body leading-7 text-foreground">
                        {characterProfile.intro}
                      </p>
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 flex items-center gap-2 text-ui-caption tracking-normal text-muted-foreground">
                        <span className="h-px w-4 bg-muted/50" />
                        {t.agentConfig.characterBackgroundLabel}
                      </div>
                      <p className="line-clamp-4 text-ui-caption leading-6 text-muted-foreground">
                        {characterProfile.background}
                      </p>
                    </div>

                    <div className="mt-5 grid grid-cols-[1fr_auto] gap-3">
                      <div className="min-w-0 border-l border-primary/45 pl-3">
                        <div className="text-ui-caption tracking-normal text-muted-foreground">
                          {t.agentConfig.characterPersonalityLabel}
                        </div>
                        <p className="mt-1 line-clamp-4 text-ui-body leading-6 text-foreground">
                          {characterProfile.personality}
                        </p>
                      </div>
                      <div className="flex w-[94px] flex-col gap-1.5">
                        {personaTags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="truncate rounded-lg border border-border/60 bg-muted/50 px-2 py-1 text-ui-caption leading-4 text-muted-foreground"
                            title={tag}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-ui-caption tracking-normal text-muted-foreground">
                            {t.agentConfig.characterVisualKeywordsLabel}
                          </span>
                          <span className="text-ui-caption text-muted-foreground">
                            {t.agentConfig.characterPromptHint}
                          </span>
                        </div>
                        <div className="flex max-h-20 flex-wrap gap-1.5 overflow-hidden">
                          {characterProfile.visualKeywords.map((keyword) => (
                            <span
                              key={keyword}
                              className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-ui-caption text-primary"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                        <div className="mb-2 flex items-center gap-2 text-ui-caption tracking-normal text-muted-foreground">
                          <span className="h-px w-4 bg-muted/50" />
                          {t.agentConfig.characterBoundaryLabel}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {boundaryTags.map((item) => (
                            <span
                              key={item}
                              className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-ui-caption leading-5 text-muted-foreground"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>

                      {canAssembleCapabilityPack ? (
                        <div className="rounded-lg border border-primary/20 bg-primary/10 p-2.5">
                          <div className="mb-2 text-ui-caption tracking-normal text-primary">
                            {t.agentConfig.capabilityPackLabel}
                          </div>
                          <button
                            className="inline-flex items-center gap-1 rounded-lg border border-primary/25 bg-muted/30 px-2 py-1 text-ui-caption tracking-normal text-primary transition hover:border-primary/45 hover:bg-primary/15"
                            disabled={installingPack}
                            type="button"
                            onClick={() => void handleAssembleCapabilityPack()}
                          >
                            {installingPack ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Sparkles className="size-3" />
                            )}
                            {t.agentWorld.assembleCapabilityPack}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {open && agent.is_installed && (
                  <div className="mt-2 shrink-0">
                    <RoleReadiness
                      agentId={agent.name}
                      onConfigure={() => openArmsConfig("skills")}
                    />
                  </div>
                )}

                {/* Bottom Tabs Section */}
                <div className="mt-3 shrink-0 space-y-2">
                  {/* Tab Navigation */}
                  <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 pb-0">
                    {[
                      { id: "overview", label: "概览", icon: "📋" },
                      { id: "growth", label: "成长数据", icon: "📈" },
                      { id: "radar", label: "能力雷达", icon: "🎯" },
                      { id: "skills", label: "技能树", icon: "🌳" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={cn(
                          "relative flex min-h-9 shrink-0 items-center gap-1.5 px-2 py-2 text-ui font-medium transition-colors",
                          activeBottomTab === tab.id
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() =>
                          setActiveBottomTab(
                            tab.id as
                              | "overview"
                              | "growth"
                              | "radar"
                              | "skills",
                          )
                        }
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                        {activeBottomTab === tab.id && (
                          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  <div className="max-h-[160px] overflow-y-auto rounded-lg bg-muted/30 p-3 [scrollbar-width:thin]">
                    {activeBottomTab === "overview" && (
                      <div className="space-y-2">
                        <div className="text-ui-caption tracking-normal text-muted-foreground">
                          角色概览
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 text-ui-caption">
                          <div className="rounded-lg border border-border/60 bg-muted/50 p-2">
                            <div className="text-muted-foreground">
                              总任务数
                            </div>
                            <div className="mt-1 text-lg font-semibold text-foreground">
                              {evolutionData?.learning_events || 0}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/50 p-2">
                            <div className="text-muted-foreground">成功率</div>
                            <div className="mt-1 text-lg font-semibold text-primary">
                              {evolutionData?.skills?.avg_success_rate
                                ? `${Math.round(evolutionData.skills.avg_success_rate * 100)}%`
                                : "N/A"}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/50 p-2">
                            <div className="text-muted-foreground">技能数</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">
                              {skillPerformances?.length || 0}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border/60 bg-muted/50 p-2">
                            <div className="text-muted-foreground">规则数</div>
                            <div className="mt-1 text-lg font-semibold text-foreground">
                              {evolutionData?.memory?.categories?.rules || 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeBottomTab === "growth" && (
                      <div className="space-y-2">
                        <div className="text-ui-caption tracking-normal text-muted-foreground">
                          成长时间线
                        </div>
                        {tabData?.timelineEvents &&
                        tabData.timelineEvents.length > 0 ? (
                          <GrowthTimeline
                            events={tabData.timelineEvents}
                            className="max-h-[120px]"
                          />
                        ) : (
                          <div className="py-4 text-center text-ui-caption text-muted-foreground">
                            暂无成长记录
                          </div>
                        )}
                      </div>
                    )}

                    {activeBottomTab === "radar" && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-ui-caption tracking-normal text-muted-foreground">
                          六维能力图
                        </div>
                        {tabData?.abilityScores &&
                        tabData.abilityScores.length > 0 ? (
                          <AbilityRadarChart
                            data={tabData.abilityScores}
                            size={140}
                            className="scale-90"
                          />
                        ) : (
                          <div className="py-8 text-center text-ui-caption text-muted-foreground">
                            暂无能力数据
                          </div>
                        )}
                      </div>
                    )}

                    {activeBottomTab === "skills" && (
                      <div className="space-y-2">
                        <div className="text-ui-caption tracking-normal text-muted-foreground">
                          技能树
                        </div>
                        {tabData?.skills && tabData.skills.length > 0 ? (
                          <SkillTree
                            skills={tabData.skills}
                            className="max-h-[120px]"
                          />
                        ) : (
                          <div className="py-4 text-center text-ui-caption text-muted-foreground">
                            暂无技能数据
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 shrink-0 border-t border-border/60 bg-card pt-2 ">
                  <div className="w-full">
                    <div className="flex items-center gap-1.5">
                      <div className="mr-1 hidden min-w-0 items-center gap-1.5 text-ui-caption tracking-normal text-muted-foreground xl:flex">
                        <span className="size-1.5 rounded-full bg-primary/80" />
                        <span className="max-w-[72px] truncate">
                          {t.agentConfig.configDockTitle}
                        </span>
                      </div>
                      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1 sm:grid-cols-4">
                        {configActions.map((action) => {
                          const Icon = action.icon;
                          return (
                            <button
                              key={action.id}
                              type="button"
                              aria-label={action.label}
                              title={`${action.label} · ${action.hint}`}
                              className="group flex h-10 min-w-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/50 px-1.5 text-foreground transition hover:border-primary/28 hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                              onClick={action.onClick}
                            >
                              <Icon className="size-3.5 shrink-0 text-primary/82" />
                              <span className="min-w-0 flex-1 text-left">
                                <span className="block truncate text-ui-caption leading-4">
                                  {action.shortLabel}
                                </span>
                                <span className="block truncate text-ui-caption leading-3 text-muted-foreground">
                                  {action.metric}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        aria-expanded={configExpanded}
                        aria-label={t.agentConfig.configDockTitle}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground transition hover:border-primary/28 hover:text-primary"
                        type="button"
                        onClick={() => setConfigExpanded((value) => !value)}
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 transition-transform",
                            configExpanded ? "-rotate-90" : "",
                          )}
                        />
                      </button>
                    </div>
                    {configExpanded ? (
                      <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                        <div className="grid grid-cols-2 gap-1.5">
                          {configActions.map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                key={action.id}
                                type="button"
                                aria-label={action.label}
                                className="group flex min-h-[40px] min-w-0 items-start gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                onClick={action.onClick}
                              >
                                <span className="flex size-5 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-primary/85 transition group-hover:border-primary/35 group-hover:bg-primary/10">
                                  <Icon className="size-3" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-ui-caption font-medium leading-4 text-foreground">
                                    {action.label}
                                  </span>
                                  <span className="line-clamp-1 block text-ui-caption leading-4 text-muted-foreground">
                                    {action.metric}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <AgentCoreVisual
                agent={{
                  ...agent,
                  avatar_url: fullAgent?.avatar_url ?? agent.avatar_url,
                  visual_urls: fullAgent?.visual_urls ?? agent.visual_urls,
                }}
                agents={agents}
                codeName={meta.codeName}
                uid={meta.uid}
                onSelectAgent={onSelectAgent}
                onCreateAgent={onCreateAgent}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-lg border-border bg-card p-0 text-foreground shadow-2xl sm:max-w-3xl">
          <div className="relative overflow-hidden border-b border-border bg-muted/30 px-5 py-4">
            <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:28px_28px]" />
            <DialogTitle className="relative">
              {t.agentConfig.configureProfileAction}
            </DialogTitle>
            <DialogDescription className="relative">
              {t.agentConfig.basicSubtitle} / {t.agentConfig.promptSubtitle}
            </DialogDescription>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5">
            <div>
              <FieldLabel label={t.agentConfig.descriptionLabel} />
              <Textarea
                className="mt-1 min-h-[96px] border-border bg-background text-sm text-foreground"
                disabled={isLoading || isSaving}
                aria-label={t.agentConfig.descriptionLabel}
                value={form.description}
                onChange={(event) =>
                  setField("description", event.target.value)
                }
              />
            </div>
            <div>
              <FieldLabel
                label={t.agentConfig.modelLabel}
                hint={t.agentConfig.modelHint}
              />
              <Input
                className="mt-1 h-9 border-border bg-background text-foreground"
                disabled={isLoading || isSaving}
                placeholder={t.agentConfig.modelPlaceholder}
                aria-label={t.agentConfig.modelLabel}
                value={form.model}
                onChange={(event) => setField("model", event.target.value)}
              />
            </div>
            <div>
              <FieldLabel label={t.agentConfig.promptTitle} />
              <Textarea
                className="mt-1 min-h-[160px] max-h-[30dvh] border-border bg-background font-mono text-xs leading-5 text-foreground"
                disabled={isLoading || isSaving}
                placeholder={t.agentConfig.soulPlaceholder}
                aria-label={t.agentConfig.promptTitle}
                value={form.soul}
                onChange={(event) => setField("soul", event.target.value)}
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 py-3">
            <Button
              className="rounded-sm"
              variant="ghost"
              onClick={() => setProfileOpen(false)}
            >
              {t.common.close}
            </Button>
            <Button
              className="rounded-sm"
              disabled={!isDirty || isLoading || isSaving}
              onClick={() => void handleSave()}
            >
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {savedFlash
                ? t.agentConfig.savedButton
                : t.agentConfig.saveButton}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgentArmsDialog
        agentId={agent.name}
        agentDisplayName={agent.display_name}
        open={armsOpen}
        onOpenChange={setArmsOpen}
        initialTab={armsInitialTab}
      />
    </>
  );
}
