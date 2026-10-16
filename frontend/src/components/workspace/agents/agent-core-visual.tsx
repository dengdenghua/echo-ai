import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Bot,
  ImagePlus,
  Link,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/components/ui/authenticated-image";
import { Button } from "@/components/ui/button";
import { withAgentAvatarVersion } from "@/core/agents/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateAgentVisuals } from "@/core/agents/hooks";
import type { AgentWorldAgent } from "@/core/agents/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import {
  buildCharacterProfile,
  buildVisualPrompt,
  DEFAULT_VISUAL_PROMPT_OPTION_IDS,
  MAX_VISUAL_REFERENCE_IMAGES,
  parseReferenceImageInput,
  readImageFileAsDataUrl,
  uniqueList,
  type VisualPromptGroup,
} from "./agent-role-profile-model";

export function AgentCoreVisual({
  agent,
  agents = [],
  codeName: _codeName,
  uid: _uid,
  onSelectAgent,
  onCreateAgent,
}: {
  agent: AgentWorldAgent;
  agents?: AgentWorldAgent[];
  codeName: string;
  uid: string;
  onSelectAgent?: (agent: AgentWorldAgent) => void;
  onCreateAgent?: () => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"front" | "side" | "back">("front");
  const [visualPromptOpen, setVisualPromptOpen] = useState(false);
  const [selectedVisualPromptIds, setSelectedVisualPromptIds] = useState<
    string[]
  >(DEFAULT_VISUAL_PROMPT_OPTION_IDS);
  const [customVisualPrompt, setCustomVisualPrompt] = useState("");
  const [referenceImageInput, setReferenceImageInput] = useState("");
  const [uploadedReferenceImages, setUploadedReferenceImages] = useState<
    string[]
  >([]);
  const generateVisuals = useGenerateAgentVisuals();
  const characterProfile = useMemo(
    () => buildCharacterProfile(agent, t),
    [agent, t],
  );
  const finalVisualPrompt = useMemo(
    () =>
      buildVisualPrompt(
        characterProfile.prompt,
        selectedVisualPromptIds,
        customVisualPrompt,
      ),
    [characterProfile.prompt, customVisualPrompt, selectedVisualPromptIds],
  );
  const referenceImages = useMemo(
    () =>
      uniqueList([
        ...parseReferenceImageInput(referenceImageInput),
        ...uploadedReferenceImages,
      ]).slice(0, MAX_VISUAL_REFERENCE_IMAGES),
    [referenceImageInput, uploadedReferenceImages],
  );
  const viewOptions = [
    ["front", t.agentConfig.viewFront],
    ["side", t.agentConfig.viewSide],
    ["back", t.agentConfig.viewBack],
  ] as const;
  const visualPromptGroups = useMemo<VisualPromptGroup[]>(
    () => [
      {
        id: "style",
        label: t.agentRoleProfile.visualPromptGroupStyle,
        options: [
          {
            id: "game-character",
            label: t.agentRoleProfile.visualPromptOptionGameCharacter,
          },
          {
            id: "clean-anime",
            label: t.agentRoleProfile.visualPromptOptionCleanAnime,
          },
          {
            id: "semi-real",
            label: t.agentRoleProfile.visualPromptOptionSemiReal,
          },
        ],
      },
      {
        id: "composition",
        label: t.agentRoleProfile.visualPromptGroupComposition,
        options: [
          {
            id: "full-body",
            label: t.agentRoleProfile.visualPromptOptionFullBody,
          },
          {
            id: "safe-headroom",
            label: t.agentRoleProfile.visualPromptOptionSafeHeadroom,
          },
          {
            id: "avatar-ready",
            label: t.agentRoleProfile.visualPromptOptionAvatarReady,
          },
          {
            id: "three-view-consistency",
            label: t.agentRoleProfile.visualPromptOptionThreeViewConsistency,
          },
        ],
      },
      {
        id: "background",
        label: t.agentRoleProfile.visualPromptGroupBackground,
        options: [
          {
            id: "transparent",
            label: t.agentRoleProfile.visualPromptOptionTransparent,
          },
          {
            id: "soft-shadow",
            label: t.agentRoleProfile.visualPromptOptionSoftShadow,
          },
        ],
      },
      {
        id: "quality",
        label: t.agentRoleProfile.visualPromptGroupQuality,
        options: [
          {
            id: "high-resolution",
            label: t.agentRoleProfile.visualPromptOptionHighResolution,
          },
          {
            id: "no-artifacts",
            label: t.agentRoleProfile.visualPromptOptionNoArtifacts,
          },
        ],
      },
    ],
    [t],
  );
  const visualUrls = agent.visual_urls ?? {};
  const activeGeneratedVisual = visualUrls[view] ?? null;
  const activeAvatar = agent.avatar_url
    ? withAgentAvatarVersion(agent.avatar_url)
    : null;
  const activeVisual = activeGeneratedVisual ?? activeAvatar;
  const isAvatarOnly = Boolean(activeVisual && !activeGeneratedVisual);
  const switchAgents = agents.length > 0 ? agents : [agent];
  const activeSwitchAgentRef = useRef<HTMLButtonElement | null>(null);
  const switchAgentEdgeSpacer = "calc(50% - 1.375rem)";

  useEffect(() => {
    const activeButton = activeSwitchAgentRef.current;
    if (!activeButton) return;
    const frame = window.requestAnimationFrame(() => {
      activeButton.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [agent.id, switchAgents.length]);

  function toggleVisualPromptOption(id: string) {
    setSelectedVisualPromptIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function handleReferenceImageUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.currentTarget.files ?? [])
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, MAX_VISUAL_REFERENCE_IMAGES);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    try {
      const dataUrls = await Promise.all(files.map(readImageFileAsDataUrl));
      setUploadedReferenceImages((current) =>
        uniqueList([...current, ...dataUrls]).slice(
          0,
          MAX_VISUAL_REFERENCE_IMAGES,
        ),
      );
    } catch {
      toast.error(t.agentRoleProfile.imageReadFailed);
    }
  }

  function removeReferenceImage(image: string) {
    setUploadedReferenceImages((current) =>
      current.filter((item) => item !== image),
    );
    setReferenceImageInput((current) =>
      parseReferenceImageInput(current)
        .filter((item) => item !== image)
        .join("\n"),
    );
  }

  async function handleGenerateVisuals() {
    try {
      await generateVisuals.mutateAsync({
        name: agent.name,
        provider: "agnes",
        stylePrompt: finalVisualPrompt,
        referenceImages,
      });
      setVisualPromptOpen(false);
      toast.success(t.agentConfig.visualGenerateSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t.agentConfig.visualGenerateFailed(message));
    }
  }

  return (
    <section className="dark relative min-h-[520px] overflow-hidden bg-background text-foreground md:min-h-0">
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:radial-gradient(circle_at_48%_62%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_30%),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:100%_100%,34px_34px,34px_34px]" />
      <div className="pointer-events-none absolute left-[11%] top-[28%] text-7xl font-black uppercase tracking-normal text-white/[0.035] 2xl:text-8xl">
        {t.agentConfig.visualWatermark}
      </div>
      <div className="pointer-events-none absolute bottom-[44%] left-[15%] text-sm font-mono uppercase tracking-[0.55em] text-white/[0.045]">
        {t.agentConfig.visualLoadoutLabel}
      </div>
      <div className="absolute right-8 top-8 z-20 rounded-sm border border-primary/20 bg-black/18 px-2 py-1 font-mono text-xs uppercase tracking-[0.32em] text-primary/80">
        REC
      </div>
      <div className="absolute right-5 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3">
        {viewOptions.map(([key, label]) => (
          <button
            key={key}
            className={cn(
              "group relative h-[74px] w-[62px] rounded-sm border bg-black/18 p-1 text-left transition xl:h-[92px] xl:w-[78px]",
              view === key
                ? "border-core"
                : "border-white/10 opacity-45 hover:opacity-85",
            )}
            type="button"
            onClick={() => setView(key)}
          >
            <span className="absolute left-2 top-2 z-10 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
              {key}
            </span>
            <span className="flex h-full items-end justify-center overflow-hidden rounded-sm bg-white/[0.035] pb-1">
              {visualUrls[key] ? (
                <AuthenticatedImage
                  alt={`${agent.display_name} ${key}`}
                  className="h-[54px] w-full object-contain xl:h-[70px]"
                  src={visualUrls[key]}
                />
              ) : (
                <Bot className="mb-5 size-6 text-muted-foreground" />
              )}
            </span>
            <span className="absolute bottom-2 right-2 font-mono text-xs uppercase text-muted-foreground">
              {label}
            </span>
          </button>
        ))}
        <Button
          aria-label={t.agentConfig.visualGenerateAction}
          className="h-8 w-[62px] rounded-sm border-primary/35 bg-black/15 px-1 text-xs xl:w-[78px]"
          disabled={generateVisuals.isPending}
          title={t.agentConfig.visualGenerateAction}
          variant="outline"
          onClick={() => setVisualPromptOpen(true)}
        >
          {generateVisuals.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
        </Button>
      </div>
      <div className="absolute left-4 top-4 z-20 hidden items-center gap-2 rounded-sm border border-white/10 bg-black/15 px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-core" />
        <span className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground">
          {t.agentConfig.visualTitle}
        </span>
      </div>
      <div className="relative z-10 h-full min-h-[520px] px-4 pb-8 pt-8 xl:min-h-[620px] xl:px-6 xl:pb-10 xl:pt-10">
        <div className="relative flex h-full min-h-0 items-end justify-center overflow-hidden pr-20 xl:pr-24">
          <div className="absolute bottom-[60px] h-16 w-[62%] rounded-[50%] border border-core/25 bg-core/10 shadow-[var(--echo-glow-core)]" />
          <div className="absolute bottom-[100px] left-[10%] right-[18%] h-px bg-white/10" />
          <div className="relative z-10 flex h-[500px] w-full max-w-[460px] items-end justify-center xl:h-[640px] xl:max-w-[580px]">
            {activeVisual ? (
              <div
                className={cn(
                  "flex w-full items-end justify-center",
                  isAvatarOnly ? "pb-24 xl:pb-28" : "h-full",
                )}
              >
                <AuthenticatedImage
                  key={activeVisual}
                  alt={`${agent.display_name} ${view}`}
                  className={cn(
                    "object-contain drop-shadow-2xl",
                    isAvatarOnly
                      ? "h-[300px] w-[300px] rounded-md border border-white/10 bg-white/95 object-center p-0 mix-blend-normal xl:h-[360px] xl:w-[360px]"
                      : "max-h-full w-full object-center",
                  )}
                  fallback={
                    <div className="mb-24 flex size-32 items-center justify-center rounded-sm border border-primary/35 bg-background text-6xl shadow-[var(--shadow-xs)]">
                      {agent.icon || (
                        <Bot className="size-16 text-muted-foreground" />
                      )}
                    </div>
                  }
                  src={activeVisual}
                />
              </div>
            ) : (
              <div className="mb-28 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <div className="flex size-32 items-center justify-center rounded-sm border border-primary/35 bg-background text-6xl shadow-[var(--shadow-xs)]">
                  {agent.icon || <Bot className="size-16" />}
                </div>
                <span className="font-mono text-xs uppercase tracking-eyebrow">
                  {t.agentConfig.visualMissing}
                </span>
              </div>
            )}
            <div className="absolute bottom-[52px] left-[6%] right-[6%] flex h-9 items-center justify-center gap-4 border-y border-core/30 bg-core/10 font-mono text-xs font-semibold uppercase tracking-[0.55em] text-core">
              <span className="h-px w-10 bg-core/40" />
              {t.agentConfig.visualSystemOnline}
              <span className="h-px w-10 bg-core/40" />
            </div>
            <div className="absolute -bottom-2 left-1/2 z-30 flex max-w-[92%] -translate-x-1/2 scroll-px-3 items-center gap-2 overflow-x-auto rounded-sm border border-white/10 bg-black/35 px-2 py-2 shadow-[0_12px_34px_rgba(0,0,0,0.28)] backdrop-blur [scrollbar-width:none]">
              <span
                aria-hidden="true"
                className="block shrink-0"
                style={{
                  minWidth: switchAgentEdgeSpacer,
                  width: switchAgentEdgeSpacer,
                }}
              />
              {switchAgents.map((candidate) => {
                const active = candidate.id === agent.id;
                const avatar = candidate.avatar_url
                  ? withAgentAvatarVersion(candidate.avatar_url)
                  : null;
                return (
                  <button
                    key={candidate.id}
                    ref={active ? activeSwitchAgentRef : undefined}
                    type="button"
                    aria-label={t.agentRoleProfile.switchToAgent(
                      candidate.display_name,
                    )}
                    title={candidate.display_name}
                    className={cn(
                      "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border bg-white/[0.04] text-sm transition",
                      active
                        ? "border-core"
                        : "border-white/12 opacity-68 hover:border-white/28 hover:opacity-100",
                    )}
                    onClick={() => {
                      if (!active) onSelectAgent?.(candidate);
                    }}
                  >
                    {avatar ? (
                      <AuthenticatedImage
                        alt={candidate.display_name}
                        className="size-full bg-white object-cover object-top"
                        src={avatar}
                      />
                    ) : (
                      <span className="text-lg leading-none">
                        {candidate.icon || <Bot className="size-4" />}
                      </span>
                    )}
                    {active ? (
                      <span className="absolute inset-x-1 bottom-1 h-0.5 rounded-full bg-core" />
                    ) : null}
                  </button>
                );
              })}
              {onCreateAgent ? (
                <button
                  type="button"
                  aria-label={t.agentWorld.newAgent}
                  title={t.agentWorld.newAgent}
                  className="group relative flex size-11 shrink-0 items-center justify-center rounded-sm border border-dashed border-white/28 bg-white/[0.04] text-muted-foreground transition hover:border-white/60 hover:bg-white/8 hover:text-foreground"
                  onClick={onCreateAgent}
                >
                  <Plus className="size-4 transition-transform group-hover:scale-110" />
                </button>
              ) : null}
              <span
                aria-hidden="true"
                className="block shrink-0"
                style={{
                  minWidth: switchAgentEdgeSpacer,
                  width: switchAgentEdgeSpacer,
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <Dialog open={visualPromptOpen} onOpenChange={setVisualPromptOpen}>
        <DialogContent className="dark max-h-[88vh] overflow-hidden rounded-sm border-white/10 bg-background p-0 text-foreground shadow-2xl sm:max-w-2xl">
          <div className="relative overflow-hidden border-b border-white/10 bg-card/90 px-5 py-4">
            <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:28px_28px]" />
            <DialogTitle className="relative flex items-center gap-2 text-base">
              <ImagePlus className="size-4 text-primary" />
              {t.agentRoleProfile.generateVisualPromptTitle}
            </DialogTitle>
            <DialogDescription className="relative mt-1 text-xs text-white/48">
              {t.agentRoleProfile.generateVisualPromptDescription}
            </DialogDescription>
          </div>

          <div className="max-h-[calc(88vh-148px)] overflow-y-auto p-5">
            <div className="grid gap-3">
              {visualPromptGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-sm border border-white/8 bg-black/18 p-3"
                >
                  <div className="mb-2 font-mono text-xs uppercase tracking-eyebrow text-white/44">
                    {group.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((option) => {
                      const active = selectedVisualPromptIds.includes(
                        option.id,
                      );
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-5 transition",
                            active
                              ? "border-core/45 bg-core/12 text-white"
                              : "border-white/10 bg-white/[0.025] text-white/52 hover:border-white/22 hover:text-white/82",
                          )}
                          onClick={() => toggleVisualPromptOption(option.id)}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              active ? "bg-core" : "bg-white/18",
                            )}
                          />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="rounded-sm border border-white/8 bg-black/18 p-3">
                <div className="mb-2 font-mono text-xs uppercase tracking-eyebrow text-white/44">
                  {t.agentRoleProfile.customAdditions}
                </div>
                <Textarea
                  className="min-h-[92px] resize-none border-white/10 bg-black/24 text-sm leading-6 text-white placeholder:text-white/28"
                  placeholder={t.agentRoleProfile.customPromptPlaceholder}
                  value={customVisualPrompt}
                  onChange={(event) =>
                    setCustomVisualPrompt(event.target.value)
                  }
                />
              </div>

              <div className="rounded-sm border border-white/8 bg-black/18 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="font-mono text-xs uppercase tracking-eyebrow text-white/44">
                    {t.agentRoleProfile.referenceImages}
                  </div>
                  <span className="text-xs text-white/36">
                    {t.agentRoleProfile.referenceImagesHint(
                      MAX_VISUAL_REFERENCE_IMAGES,
                    )}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Textarea
                    className="min-h-[58px] resize-none border-white/10 bg-black/24 text-xs leading-5 text-white placeholder:text-white/28"
                    placeholder={
                      t.agentRoleProfile.referenceImageUrlPlaceholder
                    }
                    value={referenceImageInput}
                    onChange={(event) =>
                      setReferenceImageInput(event.target.value)
                    }
                  />
                  <label className="inline-flex h-[58px] cursor-pointer items-center justify-center gap-2 rounded-sm border border-white/12 bg-white/[0.04] px-3 text-xs text-white/72 transition hover:border-white/28 hover:text-white">
                    <Upload className="size-3.5" />
                    {t.agentRoleProfile.upload}
                    <input
                      accept="image/*"
                      className="sr-only"
                      multiple
                      type="file"
                      onChange={(event) =>
                        void handleReferenceImageUpload(event)
                      }
                    />
                  </label>
                </div>
                {referenceImages.length > 0 ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                    {referenceImages.map((image, index) => (
                      <div
                        key={`${image.slice(0, 48)}-${index}`}
                        className="relative size-16 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-white/[0.035]"
                      >
                        <img
                          alt={t.agentRoleProfile.referenceImageAlt(index)}
                          className="size-full object-cover"
                          src={image}
                        />
                        <button
                          aria-label={t.agentRoleProfile.removeReferenceImage}
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-sm bg-black/62 text-white/78 transition hover:text-white"
                          type="button"
                          onClick={() => removeReferenceImage(image)}
                        >
                          <X className="size-3" />
                        </button>
                        {!image.startsWith("data:") ? (
                          <span className="absolute bottom-1 left-1 rounded-sm bg-black/62 px-1 text-xs text-white/68">
                            <Link className="inline size-2.5" />
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-sm border border-white/8 bg-white/[0.025] p-3">
                <div className="mb-2 font-mono text-xs uppercase tracking-eyebrow text-white/36">
                  Prompt Preview
                </div>
                {referenceImages.length > 0 ? (
                  <div className="mb-2 text-xs text-signal">
                    {t.agentRoleProfile.referenceImagesGenerateHint(
                      referenceImages.length,
                    )}
                  </div>
                ) : null}
                <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-white/48 [scrollbar-width:thin]">
                  {finalVisualPrompt}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-card/90 px-5 py-3">
            <Button
              className="h-8 rounded-sm border-white/12 bg-black/20 px-3 text-xs text-white/76 hover:bg-white/8 hover:text-white"
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedVisualPromptIds(DEFAULT_VISUAL_PROMPT_OPTION_IDS);
                setCustomVisualPrompt("");
                setReferenceImageInput("");
                setUploadedReferenceImages([]);
              }}
            >
              {t.agentRoleProfile.reset}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                className="h-8 rounded-sm border-white/12 bg-black/20 px-3 text-xs text-white/76 hover:bg-white/8 hover:text-white"
                type="button"
                variant="outline"
                onClick={() => setVisualPromptOpen(false)}
              >
                {t.agentRoleProfile.cancel}
              </Button>
              <Button
                className="h-8 rounded-sm px-4 text-xs"
                disabled={generateVisuals.isPending}
                type="button"
                onClick={() => void handleGenerateVisuals()}
              >
                {generateVisuals.isPending ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-3.5" />
                )}
                {t.agentRoleProfile.generateThreeViews}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
