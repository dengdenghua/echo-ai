import { CloudAgentCreation } from "@/components/workspace/agents/cloud-agent-creation";
import { ProfessionPicker } from "@/components/workspace/agents/profession-picker";
import {
  ArrowLeftIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  DatabaseIcon,
  FileSearchIcon,
  InfoIcon,
  MoreHorizontalIcon,
  SaveIcon,
  TagIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChatInputBox } from "@/components/workspace/chat-input-box";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { MessageList } from "@/components/workspace/messages";
import { ThreadProviders } from "@/components/workspace/messages/context";
import { swallow } from "@/core/utils/log";
import type { Agent } from "@/core/agents";
import { checkAgentName } from "@/core/agents/api";
import { useActiveAgentId } from "@/core/agents/active";
import { primaryPersonaAgentIdOrDefault } from "@/core/agents/persona-policy";
import {
  taskCollaboratorRouteForLeader,
  writeTaskCollaboratorPreset,
} from "@/core/collaboration/task-collaborator-preset";
import { useI18n } from "@/core/i18n/hooks";
import { useThreadStream } from "@/core/threads/hooks";
import { uuid } from "@/core/utils/uuid";
import { isIMEComposing } from "@/lib/ime";
import { cn } from "@/lib/utils";

import { NewAgentConfigPanel } from "./new-agent-config-panel";
import {
  AGENT_GENERATOR_SKILL_ID,
  NAME_RE,
  SAVE_HINT_STORAGE_KEY,
  TEMPLATE_PROMPTS,
  buildGuidedConfigPrompt,
  buildTemplatePrompt,
  getAgentWithRetry,
  suggestAgentName,
  uniqueValues,
  type AgentCapabilityPack,
  type AgentRolePreset,
  type AgentScenePreset,
  type AgentTemplate,
} from "./new-agent-model";

type Step = "name" | "chat";
type SetupAgentStatus = "idle" | "requested" | "completed";

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  "team-qa": <BotIcon className="size-4" />,
  "morning-planner": <CalendarDaysIcon className="size-4" />,
  "defect-triage": <TagIcon className="size-4" />,
  "data-analyst": <DatabaseIcon className="size-4" />,
  "exec-assistant": <BriefcaseBusinessIcon className="size-4" />,
  "knowledge-search": <FileSearchIcon className="size-4" />,
};

export default function NewAgentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const activeAgentId = useActiveAgentId();
  const creationLeaderId = primaryPersonaAgentIdOrDefault(activeAgentId);
  const [searchParams] = useSearchParams();
  const requestedTemplateId = searchParams.get("template");
  const requestedRoleId = searchParams.get("roleId");
  const requestedRoleName = searchParams.get("role");
  const requestedRoleFocus = searchParams.get("focus");
  const requestedRoleCapability = searchParams.get("capability");
  const galleryReturnPath =
    searchParams.get("return") === "hud"
      ? "/workspace/agents?hud=1&surface=chat"
      : "/workspace/agents";

  const agentNew = t.agents.agentNew;

  const AGENT_TEMPLATES: AgentTemplate[] = useMemo(
    () =>
      agentNew.templates.map((tpl) => ({
        id: tpl.id,
        icon: TEMPLATE_ICONS[tpl.id] ?? <BotIcon className="size-4" />,
        name: tpl.name,
        nameSuggestion: tpl.nameSuggestion,
        description: tpl.description,
        prompt: TEMPLATE_PROMPTS[tpl.id] ?? "",
        integrations: tpl.integrations,
        capabilities: tpl.capabilities,
      })),
    [agentNew.templates],
  );

  const ROLE_PRESETS: AgentRolePreset[] = useMemo(
    () => agentNew.roles,
    [agentNew.roles],
  );
  const SCENE_PRESETS: AgentScenePreset[] = useMemo(
    () => agentNew.scenarios,
    [agentNew.scenarios],
  );
  const CAPABILITY_PACKS: AgentCapabilityPack[] = useMemo(
    () => agentNew.abilities,
    [agentNew.abilities],
  );

  const initialTemplateId = useMemo(() => {
    if (
      requestedTemplateId &&
      AGENT_TEMPLATES.some((template) => template.id === requestedTemplateId)
    ) {
      return requestedTemplateId;
    }
    return AGENT_TEMPLATES[0]?.id ?? "";
  }, [requestedTemplateId, AGENT_TEMPLATES]);

  const [step, setStep] = useState<Step>("name");
  const [nameInput, setNameInput] = useState("");
  const [agentBrief, setAgentBrief] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<string>(initialTemplateId);
  const [selectedRolePresetId, setSelectedRolePresetId] = useState(
    ROLE_PRESETS[0]?.id ?? "",
  );
  const [selectedScenePresetIds, setSelectedScenePresetIds] = useState<
    string[]
  >(SCENE_PRESETS[0]?.id ? [SCENE_PRESETS[0].id] : []);
  const [selectedCapabilityPackIds, setSelectedCapabilityPackIds] = useState<
    string[]
  >(CAPABILITY_PACKS[0]?.id ? [CAPABILITY_PACKS[0].id] : []);
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [showSaveHint, setShowSaveHint] = useState(false);
  const [setupAgentStatus, setSetupAgentStatus] =
    useState<SetupAgentStatus>("idle");

  const threadId = useMemo(() => uuid(), []);
  const selectedTemplate = useMemo(
    () =>
      AGENT_TEMPLATES.find((template) => template.id === selectedTemplateId) ??
      AGENT_TEMPLATES[0],
    [AGENT_TEMPLATES, selectedTemplateId],
  );
  const selectedRolePreset = useMemo(
    () =>
      ROLE_PRESETS.find((preset) => preset.id === selectedRolePresetId) ??
      ROLE_PRESETS[0],
    [ROLE_PRESETS, selectedRolePresetId],
  );
  const selectedScenePresets = useMemo(
    () =>
      SCENE_PRESETS.filter((preset) =>
        selectedScenePresetIds.includes(preset.id),
      ),
    [SCENE_PRESETS, selectedScenePresetIds],
  );
  const selectedCapabilityPacks = useMemo(
    () =>
      CAPABILITY_PACKS.filter((pack) =>
        selectedCapabilityPackIds.includes(pack.id),
      ),
    [CAPABILITY_PACKS, selectedCapabilityPackIds],
  );
  const selectedArms = useMemo(
    () => uniqueValues(selectedCapabilityPacks.flatMap((pack) => pack.arms)),
    [selectedCapabilityPacks],
  );
  const selectedSkills = useMemo(
    () =>
      uniqueValues([
        AGENT_GENERATOR_SKILL_ID,
        ...selectedCapabilityPacks.flatMap((pack) => pack.skills),
      ]),
    [selectedCapabilityPacks],
  );
  const selectedPermissions = useMemo(
    () =>
      uniqueValues(selectedScenePresets.flatMap((scene) => scene.permissions)),
    [selectedScenePresets],
  );

  useEffect(() => {
    if (!requestedTemplateId) return;
    const requestedTemplate = AGENT_TEMPLATES.find(
      (template) => template.id === requestedTemplateId,
    );
    if (!requestedTemplate) return;
    setSelectedTemplateId(requestedTemplate.id);
    setAgentBrief((current) =>
      current.trim()
        ? current
        : buildTemplatePrompt(
            requestedTemplate,
            requestedRoleName,
            requestedRoleFocus,
            requestedRoleCapability,
          ),
    );
    setNameInput((current) =>
      current.trim()
        ? current
        : (requestedRoleId ?? requestedTemplate.nameSuggestion),
    );
  }, [
    AGENT_TEMPLATES,
    requestedRoleCapability,
    requestedRoleFocus,
    requestedRoleId,
    requestedRoleName,
    requestedTemplateId,
  ]);

  const [thread, sendMessage] = useThreadStream({
    threadId: step === "chat" ? threadId : undefined,
    context: {
      agent_name: creationLeaderId,
      mode: "chat",
      is_bootstrap: true,
    },
    onFinish() {
      if (!agent && setupAgentStatus === "requested") {
        setSetupAgentStatus("idle");
      }
    },
    onToolEnd({ name }) {
      if (name !== "setup_agent" || !agentName) return;
      setSetupAgentStatus("completed");
      void getAgentWithRetry(agentName).then((fetched) => {
        if (fetched) {
          setAgent(fetched);
          return;
        }

        toast.error(t.agents.agentCreatedPendingRefresh);
      });
    },
  });

  useEffect(() => {
    if (typeof window === "undefined" || step !== "chat") {
      return;
    }
    if (window.localStorage.getItem(SAVE_HINT_STORAGE_KEY) === "1") {
      return;
    }
    setShowSaveHint(true);
    window.localStorage.setItem(SAVE_HINT_STORAGE_KEY, "1");
  }, [step]);

  const handleConfirmName = useCallback(async () => {
    const brief = agentBrief.trim();
    const trimmed = (nameInput.trim() || suggestAgentName(brief)).toLowerCase();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }

    setNameError("");
    setIsCheckingName(true);
    try {
      const result = await checkAgentName(trimmed);
      if (!result.available) {
        setNameError(t.agents.nameStepAlreadyExistsError);
        return;
      }
    } catch (err) {
      swallow(err);
      if (err instanceof TypeError && err.message === "Failed to fetch") {
        setNameError(t.agents.nameStepNetworkError);
      } else {
        setNameError(t.agents.nameStepCheckError);
      }
      return;
    } finally {
      setIsCheckingName(false);
    }

    setAgentName(trimmed);
    setStep("chat");
    const templateBlock = selectedTemplate
      ? [
          `参考模板: ${selectedTemplate.name}`,
          `适用集成: ${selectedTemplate.integrations.join(", ")}`,
          "建议能力:",
          ...selectedTemplate.capabilities.map(
            (capability) => `- ${capability}`,
          ),
        ].join("\n")
      : "";
    const configBlock = [
      `默认 Skill: ${AGENT_GENERATOR_SKILL_ID}`,
      `建议 ARM: ${selectedArms.join(", ") || "按任务需要收敛选择"}`,
      `建议 private_skills: ${selectedSkills.join(", ")}`,
      `权限边界: ${selectedPermissions.join("；") || "高风险动作需要用户确认"}`,
    ].join("\n");
    await sendMessage(threadId, {
      text: [
        t.agents.nameStepBootstrapMessage.replace("{name}", trimmed),
        "",
        "请使用 agent-generator Skill，根据用户的简短描述生成这个 Agent 的 SOUL、ARM/tool_groups、private_skills、权限边界、默认工作流和首次任务。模板只是参考，不要强制套模板；如果用户目标与模板冲突，以用户目标为准。",
        "",
        "[用户一句话描述]",
        brief ||
          "用户尚未补充更多描述，请基于参考模板生成一个简洁可用的 Agent 初稿。",
        "",
        "[配置偏好]",
        configBlock,
        "",
        templateBlock,
      ]
        .filter(Boolean)
        .join("\n"),
      files: [],
    });
  }, [
    agentBrief,
    nameInput,
    sendMessage,
    selectedTemplate,
    selectedArms,
    selectedPermissions,
    selectedSkills,
    t.agents.nameStepAlreadyExistsError,
    t.agents.nameStepNetworkError,
    t.agents.nameStepBootstrapMessage,
    t.agents.nameStepCheckError,
    t.agents.nameStepInvalidError,
    threadId,
  ]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isIMEComposing(e)) {
      e.preventDefault();
      void handleConfirmName();
    }
  };

  const handleSelectTemplate = useCallback((template: AgentTemplate) => {
    setSelectedTemplateId(template.id);
    setAgentBrief(template.prompt);
    setNameInput((current) =>
      current.trim() ? current : template.nameSuggestion,
    );
    setNameError("");
  }, []);

  const toggleSelectedScenePreset = useCallback((id: string) => {
    setSelectedScenePresetIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);

  const toggleSelectedCapabilityPack = useCallback((id: string) => {
    setSelectedCapabilityPackIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);

  const handleApplyGuidedConfig = useCallback(() => {
    if (
      !selectedRolePreset ||
      selectedScenePresets.length === 0 ||
      selectedCapabilityPacks.length === 0
    ) {
      return;
    }
    const nextBrief = buildGuidedConfigPrompt({
      role: selectedRolePreset,
      scenes: selectedScenePresets,
      packs: selectedCapabilityPacks,
      template: selectedTemplate,
    });
    setAgentBrief(nextBrief);
    setNameInput((current) =>
      current.trim() ? current : selectedRolePreset.nameSuggestion,
    );
    setNameError("");
  }, [
    selectedCapabilityPacks,
    selectedRolePreset,
    selectedScenePresets,
    selectedTemplate,
  ]);

  const handleChatSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thread.isLoading) return;
      await sendMessage(
        threadId,
        { text: trimmed, files: [] },
        { agent_name: creationLeaderId },
      );
    },
    [creationLeaderId, sendMessage, thread.isLoading, threadId],
  );

  const handleSaveAgent = useCallback(async () => {
    if (
      !agentName ||
      agent ||
      thread.isLoading ||
      setupAgentStatus !== "idle"
    ) {
      return;
    }

    setSetupAgentStatus("requested");
    setShowSaveHint(false);
    try {
      await sendMessage(
        threadId,
        { text: t.agents.saveCommandMessage, files: [] },
        { agent_name: creationLeaderId },
        { additionalKwargs: { hide_from_ui: true } },
      );
      toast.success(t.agents.saveRequested);
    } catch (error) {
      setSetupAgentStatus("idle");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    agent,
    agentName,
    creationLeaderId,
    sendMessage,
    setupAgentStatus,
    t.agents.saveCommandMessage,
    t.agents.saveRequested,
    thread.isLoading,
    threadId,
  ]);

  const header = (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(galleryReturnPath)}
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold">{t.agents.createPageTitle}</h1>
      </div>

      {step === "chat" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t.agents.more}>
              <MoreHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => void handleSaveAgent()}
              disabled={
                !!agent || thread.isLoading || setupAgentStatus !== "idle"
              }
            >
              <SaveIcon className="h-4 w-4" />
              {setupAgentStatus === "requested"
                ? t.agents.saving
                : t.agents.save}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </header>
  );

  if (searchParams.get("cloudExpert")) return <div className="flex min-h-0 flex-1 flex-col">{header}<CloudAgentCreation key={searchParams.get("cloudExpert")} sourceId={searchParams.get("cloudExpert")!} /></div>;

  if (step === "name") {
    return (
      <div className="relative flex size-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_18%,color-mix(in_oklab,var(--primary)_8%,transparent),transparent_34%),linear-gradient(to_bottom,var(--background),color-mix(in_oklab,var(--muted)_28%,transparent))] p-6 text-foreground">
        <div className="pointer-events-none absolute inset-x-[20%] top-[8%] h-24 rounded-[50%] bg-primary/10 blur-3xl" />
        <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[1080px] overflow-y-auto rounded-lg border border-border bg-card shadow-[var(--shadow-xl)] ring-1 ring-black/20 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 opacity-[0.09] [background-image:radial-gradient(circle_at_76%_28%,color-mix(in_oklab,var(--echo-core)_10%,transparent),transparent_30%),linear-gradient(to_right,rgba(255,255,255,0.032)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.024)_1px,transparent_1px)] [background-size:100%_100%,40px_40px,40px_40px]" />
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-core/24 to-transparent" />
          <div className="pointer-events-none absolute inset-x-14 bottom-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
          <div className="relative grid h-full grid-cols-1 lg:grid-cols-[minmax(0,0.64fr)_minmax(260px,0.36fr)]">
            <section className="relative flex min-h-0 flex-col px-8 py-6 lg:px-10 lg:py-7">
              <div className="pointer-events-none absolute left-0 top-0 h-5 w-5 border-l border-t border-primary/60" />
              <div className="mb-6 flex shrink-0 items-center justify-between">
                <Button
                  aria-label={t.agentConfig.back}
                  className="h-8 w-8 shrink-0 rounded-sm text-foreground hover:bg-muted/8 hover:text-foreground"
                  size="icon"
                  variant="ghost"
                  onClick={() => navigate(galleryReturnPath)}
                >
                  <ArrowLeftIcon className="size-4" />
                </Button>
                <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/[0.025] px-2 py-1 text-xs font-medium text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  智能体配置
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]">
                <div className="max-w-[560px] pb-6">
                  <div className="flex items-center gap-2 text-xs font-medium text-primary">
                    <span className="h-px w-6 bg-primary/70" />
                    新建智能体
                  </div>
                  <h1 className="mt-4 text-3xl sm:text-4xl font-semibold leading-none text-foreground">
                    {agentNew.pageTitle}
                  </h1>
                  <p className="mt-3 text-lg font-medium leading-7 text-primary">
                    {agentNew.pageSubtitle}
                  </p>

                  <ProfessionPicker onSelect={(profession) => {
                    setSelectedTemplateId("");
                    setAgentBrief(`创建一位${profession.name}数字员工。\n${profession.description}\n请明确岗位职责、常见任务、交付物和协作边界，并根据职责建议合适的技能与工具。仅使用已授权且实际可用的能力。`);
                    setNameInput((current) => current.trim() ? current : profession.id ? `${profession.id}-assistant` : "");
                    setNameError("");
                  }} />

                  <div className="mt-6 rounded-sm border border-border bg-muted/16 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        任务目标
                      </span>
                      <span
                        lang="en"
                        className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground"
                      >
                        Ctrl/⌘ + Enter
                      </span>
                    </div>
                    <textarea
                      autoFocus
                      aria-label="任务目标"
                      value={agentBrief}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAgentBrief(value);
                        if (!nameInput.trim()) {
                          setNameInput(suggestAgentName(value));
                        }
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey) &&
                          !isIMEComposing(event)
                        ) {
                          event.preventDefault();
                          void handleConfirmName();
                        }
                      }}
                      placeholder={agentNew.placeholder}
                      className="min-h-[190px] w-full resize-none bg-transparent text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-[82px_1fr] items-center gap-3 rounded-sm border border-border bg-muted/[0.035] px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      智能体 ID
                    </span>
                    <Input
                      aria-label="智能体 ID"
                      aria-invalid={Boolean(nameError)}
                      placeholder={t.agents.nameStepPlaceholder}
                      value={nameInput}
                      onChange={(e) => {
                        setNameInput(e.target.value.toLowerCase());
                        setNameError("");
                      }}
                      onKeyDown={handleNameKeyDown}
                      className={cn(
                        "h-8 rounded-sm border-border bg-muted/20 font-mono text-xs text-foreground placeholder:text-muted-foreground",
                        nameError && "border-destructive",
                      )}
                    />
                  </div>

                  {nameError ? (
                    <p className="mt-2 text-xs leading-5 text-destructive">
                      {nameError}
                    </p>
                  ) : null}

                  <div className="mt-5 flex items-center gap-2">
                    <Button
                      className="h-9 rounded-sm bg-primary px-5 text-primary-foreground hover:bg-primary/90"
                      onClick={() => void handleConfirmName()}
                      disabled={
                        (!agentBrief.trim() && !selectedTemplate) ||
                        isCheckingName
                      }
                    >
                      {isCheckingName
                        ? agentNew.buttons.checking
                        : agentNew.buttons.generate}
                    </Button>
                    <Button
                      className="h-9 rounded-sm border border-border bg-muted/30 px-4 text-foreground hover:border-border hover:bg-muted/8 hover:text-foreground"
                      variant="outline"
                      onClick={() => navigate(galleryReturnPath)}
                    >
                      {agentNew.buttons.back}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <NewAgentConfigPanel
              templates={AGENT_TEMPLATES}
              selectedTemplate={selectedTemplate}
              selectedTemplateId={selectedTemplateId}
              onSelectTemplate={handleSelectTemplate}
              rolePresets={ROLE_PRESETS}
              selectedRolePresetId={selectedRolePresetId}
              onSelectRolePreset={setSelectedRolePresetId}
              scenePresets={SCENE_PRESETS}
              selectedScenePresetIds={selectedScenePresetIds}
              onToggleScenePreset={toggleSelectedScenePreset}
              capabilityPacks={CAPABILITY_PACKS}
              selectedCapabilityPackIds={selectedCapabilityPackIds}
              onToggleCapabilityPack={toggleSelectedCapabilityPack}
              showConfigSummary={
                selectedScenePresets.length > 0 &&
                selectedCapabilityPacks.length > 0
              }
              selectedArms={selectedArms}
              selectedSkills={selectedSkills}
              selectedPermissions={selectedPermissions}
              onApplyGuidedConfig={handleApplyGuidedConfig}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ThreadProviders thread={thread}>
      <ArtifactsProvider>
        <div className="flex size-full flex-col">
          {header}

          <main className="flex min-h-0 flex-1 flex-col">
            {showSaveHint ? (
              <div className="px-4 pt-4">
                <div className="mx-auto w-full max-w-(--container-width-md)">
                  <Alert>
                    <InfoIcon className="h-4 w-4" />
                    <AlertDescription>{t.agents.saveHint}</AlertDescription>
                  </Alert>
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList
                className={cn("size-full", showSaveHint ? "pt-4" : "pt-10")}
                threadId={threadId}
                thread={thread}
                mode="chat"
              />
            </div>

            <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
              <div className="w-full max-w-(--container-width-md)">
                {agent ? (
                  <div className="flex flex-col items-center gap-4 rounded-lg border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent py-8 text-center">
                    <div className="flex size-12 items-center justify-center rounded-md bg-primary/10">
                      <CheckCircleIcon className="text-primary h-6 w-6" />
                    </div>
                    <p className="font-semibold">{t.agents.agentCreated}</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          const leaderId = creationLeaderId;
                          writeTaskCollaboratorPreset({
                            leaderId,
                            collaboratorIds: [agentName],
                            mode: "cluster",
                            label: agent.display_name || agent.name,
                            openPicker: true,
                          });
                          void navigate(taskCollaboratorRouteForLeader(leaderId));
                        }}
                      >
                        {t.agentCard.addOnDemand}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate(galleryReturnPath)}
                      >
                        {t.agents.backToGallery}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <ChatInputBox
                    threadId={threadId}
                    onSubmit={({ text }) => void handleChatSubmit(text)}
                    disabled={thread.isLoading}
                    placeholder={t.agents.createPageSubtitle}
                    autoFocus
                  />
                )}
              </div>
            </div>
          </main>
        </div>
      </ArtifactsProvider>
    </ThreadProviders>
  );
}
