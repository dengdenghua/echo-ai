import { openCustomModelSetup } from "@/core/models/setup";
import { supportedReasoningEfforts } from "@/core/models/execution-capabilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  KeyRoundIcon,
  Loader2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CoderAPIError,
  coderQueryKeys,
  getCoderAccount,
  getCoderModelProfile,
  getCoderModels,
  updateCoderModelProfile,
} from "@/core/coder/api";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { moveTabFocusWithin } from "@/lib/menu-tab-focus";
import { useAuth } from "@/providers/AuthProvider";
import type { ReasoningEffort } from "@/core/threads";
import {
  isFreePickerModel,
  ModelContextSetting,
  type PickerModel,
} from "@/components/workspace/model-picker";

import { coderEngineCopy } from "@/core/i18n/locales/coder-engine";

import {
  compactProfileLabel,
  isCoderSystemModel,
  modelMatches,
  pickerModelValue,
  profileCanExecute,
  profileLabel,
  ProfileCompatibility,
  reasoningLabel,
  systemModelFamilyKey,
} from "./coder-engine-profile";

export function CoderEngineControl({
  systemModels = [],
  disabled = false,
  executionEngine = "codex",
  value,
  onChange,
  onEffectiveModelChange,
  reasoningEffort,
  onReasoningEffortChange,
}: {
  systemModels?: PickerModel[];
  disabled?: boolean;
  executionEngine?: "echo" | "codex";
  value?: string;
  onChange?: (model: string) => void;
  onEffectiveModelChange?: (model: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
}) {
  const { locale } = useI18n();
  const copy = coderEngineCopy(locale);
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const principalKey = user?.actor_id || user?.user_id || "local";
  const queryKeys = useMemo(() => coderQueryKeys(principalKey), [principalKey]);
  const [open, setOpen] = useState(false);
  const [viewSource, setViewSource] = useState<
    "follow_system" | "codex_account"
  >("follow_system");
  const profileQuery = useQuery({
    queryKey: queryKeys.profile,
    queryFn: ({ signal }) => getCoderModelProfile(signal),
    enabled: !authLoading,
    staleTime: 30_000,
  });
  const accountQuery = useQuery({
    queryKey: queryKeys.account,
    queryFn: ({ signal }) => getCoderAccount(signal),
    enabled: !authLoading,
    staleTime: 10_000,
  });
  const modelsQuery = useQuery({
    queryKey: queryKeys.models,
    queryFn: ({ signal }) => getCoderModels(signal),
    enabled: Boolean(accountQuery.data?.account),
    staleTime: 60_000,
  });
  const saveProfile = useMutation({
    scope: { id: `coder-model-profile:${principalKey}` },
    mutationFn: updateCoderModelProfile,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile });
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile, profile);
    },
  });
  const profile = profileQuery.data;
  const nativeKernel = executionEngine === "echo";
  const pendingNativeModelRef = useRef(value || "auto");
  useEffect(() => {
    pendingNativeModelRef.current = value || "auto";
  }, [value]);
  const nativeAccountModel = nativeKernel
    ? String(value || "").replace(/^chatgpt[/:]/i, "")
    : "";
  const nativeAccountSelected =
    nativeKernel && /^chatgpt[/:]/i.test(String(value || ""));
  const chatGPTSubscriptionConnected =
    accountQuery.data?.account?.type === "chatgpt";
  const visibleAccountSource =
    accountQuery.data?.account?.type === "apiKey"
      ? copy.apiKeySource
      : copy.subscriptionSource;
  const visibleSystemModels = useMemo(() => {
    const seen = new Set<string>();
    return [...systemModels]
      .filter((model) => {
        if (!isCoderSystemModel(model)) return false;
        if (model.entry_id === "official") return false;
        if (["opencode-zen", "opencode-go"].includes(model.entry_id || ""))
          return false;
        if (model.context_profile === "1m") return false;
        const key = pickerModelValue(model);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [systemModels]);
  const activeSystemModel = useMemo(
    () =>
      (nativeKernel
        ? systemModels.find((model) => modelMatches(model, value))
        : profile?.source === "follow_system"
          ? systemModels.find((model) =>
              modelMatches(
                model,
                profile.selected_model || profile.effective_model,
              ),
            )
          : undefined) ??
      systemModels.find((model) => modelMatches(model, profile?.system_model)),
    [
      profile?.effective_model,
      profile?.selected_model,
      profile?.source,
      profile?.system_model,
      systemModels,
      nativeKernel,
      value,
    ],
  );
  const visibleSystemModelName =
    activeSystemModel?.display_name ||
    activeSystemModel?.name ||
    activeSystemModel?.model ||
    (!nativeKernel
      ? profile?.effective_model?.replace(/^official\//, "")
      : undefined) ||
    value?.replace(/^official\//, "") ||
    "auto";
  const visibleSystemSource = activeSystemModel?.source_display_name;
  const fullProfileLabel = nativeKernel
    ? nativeAccountSelected
      ? `${copy.subscriptionModeShort} · ${nativeAccountModel}`
      : `${visibleSystemSource || copy.followSystemShort} · ${visibleSystemModelName}`
    : profile?.source === "codex_account" && profile.effective_model
      ? `${visibleAccountSource} · ${profile.effective_model}`
      : profile?.source === "follow_system"
        ? `${visibleSystemSource || copy.followSystemShort} · ${visibleSystemModelName}`
        : profileLabel(profile, copy);
  const activeCodexModel = useMemo(
    () =>
      nativeKernel
        ? modelsQuery.data?.models.find(
            (model) => model.id === nativeAccountModel,
          )
        : profile?.source === "codex_account"
          ? modelsQuery.data?.models.find(
              (model) =>
                model.id === profile?.effective_model ||
                (!profile?.effective_model && model.is_default),
            )
          : undefined,
    [
      modelsQuery.data?.models,
      nativeAccountModel,
      nativeKernel,
      profile?.effective_model,
      profile?.source,
    ],
  );
  const offeredEfforts = useMemo(
    () =>
      supportedReasoningEfforts(
        viewSource === "codex_account" ? activeCodexModel : activeSystemModel,
      ),
    [activeCodexModel, activeSystemModel, viewSource],
  );

  const changeReasoningEffort = (effort: ReasoningEffort) => {
    if (nativeKernel) {
      onReasoningEffortChange?.(effort);
      return;
    }
    if (!profile) return;
    saveProfile.mutate({
      source: viewSource,
      ...(profile.source === viewSource && profile.selected_model
        ? { model: profile.selected_model }
        : {}),
      reasoning_effort: effort,
    });
  };

  const selectSystemModel = (model?: string) => {
    if (nativeKernel) {
      const nextValue = model || "auto";
      const pendingValue = pendingNativeModelRef.current;
      const pendingSystemModel = model
        ? systemModels.find((candidate) => modelMatches(candidate, model))
        : undefined;
      const alreadySelected = model
        ? !/^chatgpt[/:]/i.test(pendingValue) &&
          Boolean(
            pendingSystemModel &&
            modelMatches(pendingSystemModel, pendingValue),
          )
        : !/^chatgpt[/:]/i.test(pendingValue) &&
          (!pendingValue ||
            pendingValue === "auto" ||
            pendingValue === "default");
      if (alreadySelected) return;
      pendingNativeModelRef.current = nextValue;
      onChange?.(nextValue);
      onEffectiveModelChange?.(
        pendingSystemModel?.display_name ||
          pendingSystemModel?.model ||
          model ||
          profile?.system_model ||
          copy.systemDefault,
      );
      return;
    }
    const alreadySelected = model
      ? profile?.source === "follow_system" &&
        profile.model_source === "role" &&
        Boolean(activeSystemModel && modelMatches(activeSystemModel, model))
      : profile?.source === "follow_system" &&
        profile.model_source === "system";
    if (alreadySelected) return;
    saveProfile.mutate(
      {
        source: "follow_system",
        ...(model ? { model } : {}),
        reasoning_effort: null,
      },
      {
        onSuccess: (nextProfile) =>
          onEffectiveModelChange?.(
            nextProfile.effective_model || model || copy.systemDefault,
          ),
      },
    );
  };

  const selectAccountModel = (model: string) => {
    if (nativeKernel) {
      const nextValue = `chatgpt/${model}`;
      if (pendingNativeModelRef.current === nextValue) return;
      pendingNativeModelRef.current = nextValue;
      onChange?.(nextValue);
      onEffectiveModelChange?.(model);
      return;
    }
    if (
      profile?.source === "codex_account" &&
      profile.effective_model === model
    ) {
      return;
    }
    saveProfile.mutate(
      { source: "codex_account", model },
      {
        onSuccess: (nextProfile) =>
          onEffectiveModelChange?.(nextProfile.effective_model || model),
      },
    );
  };

  const controlPending = !nativeKernel && saveProfile.isPending;
  const compactLabel = nativeKernel
    ? nativeAccountSelected
      ? nativeAccountModel
      : visibleSystemModelName
    : profile?.source === "follow_system" && activeSystemModel
      ? visibleSystemModelName
      : compactProfileLabel(profile, copy)?.replace(/^official\//, "");
  const selectedReasoningEffort = nativeKernel
    ? reasoningEffort
    : profile?.reasoning_effort;
  const activeSystemSelectionValue = nativeKernel
    ? value
    : profile?.source === "follow_system"
      ? profile.selected_model || profile.effective_model
      : profile?.system_model;

  const openModelSettings = () => {
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent("echo:open-settings", { detail: { tab: "models" } }),
    );
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setViewSource(
            nativeKernel
              ? nativeAccountSelected
                ? "codex_account"
                : "follow_system"
              : profile?.source || "follow_system",
          );
        }
      }}
    >
      <Tooltip delayDuration={80}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="coder-engine-trigger"
              aria-label={fullProfileLabel}
              className="inline-flex h-[42px] min-w-0 max-w-32 items-center gap-1 rounded-lg border border-transparent bg-transparent px-2 text-xs sm:h-8 text-muted-foreground outline-none transition hover:border-border-default hover:bg-muted/60 hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
              disabled={disabled}
            >
              {/* A quiet placeholder while the profile loads: a spinner beside a
                  generic "Coder 模型" read like a stuck control. */}
              {profileQuery.isLoading && !nativeKernel ? (
                <span
                  aria-hidden="true"
                  className="h-3 w-16 animate-pulse rounded bg-muted"
                />
              ) : (
                <span
                  className={cn(
                    "truncate",
                    !nativeAccountSelected &&
                      isFreePickerModel(activeSystemModel) &&
                      "text-core",
                  )}
                >
                  {compactLabel}
                </span>
              )}
              <ChevronDownIcon className="size-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {fullProfileLabel}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-72 p-1.5"
        onKeyDown={moveTabFocusWithin}
      >
        {profileQuery.isError ? (
          <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.04] p-2 text-xs text-destructive">
            <div>{copy.loadFailed}</div>
            <button
              type="button"
              className="font-medium hover:underline"
              onClick={() => void profileQuery.refetch()}
            >
              {copy.retry}
            </button>
          </div>
        ) : profile ? (
          <>
            <div className="flex flex-wrap gap-0.5 rounded-lg bg-muted/45 p-0.5 [&>button]:flex-1 [&>button]:whitespace-nowrap">
              <button
                type="button"
                aria-pressed={viewSource === "follow_system"}
                disabled={controlPending}
                onClick={() => {
                  setViewSource("follow_system");
                }}
                className={cn(
                  "h-7 rounded-md px-2 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40",
                  viewSource === "follow_system"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {copy.systemSource}
              </button>
              <button
                type="button"
                aria-pressed={viewSource === "codex_account"}
                disabled={controlPending}
                onClick={() => setViewSource("codex_account")}
                className={cn(
                  "h-7 rounded-md px-2 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/40",
                  viewSource === "codex_account"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Codex
              </button>
            </div>

            <div className="mt-1 max-h-52 space-y-0.5 overflow-y-auto">
              {viewSource === "follow_system" ? (
                <>
                  {visibleSystemModels.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      {copy.noModelsAddBelow}
                    </p>
                  )}
                  {visibleSystemModels.map((model, index) => {
                    const selected = nativeKernel
                      ? !nativeAccountSelected && modelMatches(model, value)
                      : profile.source === "follow_system" &&
                        profile.model_source === "role" &&
                        modelMatches(
                          model,
                          profile.selected_model || profile.effective_model,
                        );
                    const contextVariantSelected = Boolean(
                      activeSystemModel &&
                      systemModelFamilyKey(activeSystemModel) ===
                        systemModelFamilyKey(model) &&
                      (nativeKernel
                        ? !nativeAccountSelected &&
                          value !== "auto" &&
                          value !== "default"
                        : profile.source === "follow_system" &&
                          profile.model_source === "role"),
                    );
                    return (
                      <div
                        key={`${pickerModelValue(model)}:${model.id || model.model || index}:${index}`}
                        className={cn(
                          "flex h-8 w-full items-stretch rounded-md text-xs hover:bg-muted/60",
                          (selected || contextVariantSelected) &&
                            "bg-muted/70 text-foreground",
                        )}
                      >
                        <button
                          type="button"
                          disabled={controlPending}
                          onClick={() =>
                            selectSystemModel(pickerModelValue(model))
                          }
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left"
                        >
                          <span
                            className={cn(
                              "truncate",
                              isFreePickerModel(model) && "text-core",
                            )}
                          >
                            {model.display_name || model.name}
                          </span>
                          {selected || contextVariantSelected ? (
                            <CheckCircle2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </>
              ) : accountQuery.data?.account &&
                (!nativeKernel || chatGPTSubscriptionConnected) ? (
                <>
                  {(modelsQuery.data?.models ?? []).map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      disabled={controlPending}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                        (nativeKernel
                          ? nativeAccountSelected &&
                            nativeAccountModel === model.id
                          : profile.source === "codex_account" &&
                            profile.effective_model === model.id) &&
                          "bg-muted/70 text-foreground",
                      )}
                      onClick={() => selectAccountModel(model.id)}
                    >
                      <span className="truncate">
                        {model.display_name || model.id}
                      </span>
                      {(
                        nativeKernel
                          ? nativeAccountSelected &&
                            nativeAccountModel === model.id
                          : profile.source === "codex_account" &&
                            profile.effective_model === model.id
                      ) ? (
                        <CheckCircle2Icon className="size-3.5 shrink-0" />
                      ) : null}
                    </button>
                  ))}
                  {modelsQuery.isLoading ? (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3 animate-spin" />{" "}
                      {copy.loading}
                    </div>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  onClick={openModelSettings}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <UserRoundIcon className="size-3.5" />
                  {copy.signInToChoose}
                </button>
              )}
            </div>

            {offeredEfforts.length > 0 ? (
              <div className="mt-1 border-t border-border-default pt-1">
                <div className="flex items-center justify-between px-1 pb-1 text-xs text-muted-foreground">
                  <span>{copy.reasoningShort}</span>
                </div>
                <div
                  className="grid gap-0.5 rounded-md bg-muted/35 p-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${offeredEfforts.length}, minmax(0, 1fr))`,
                  }}
                >
                  {offeredEfforts.map((effort) => (
                    <button
                      key={effort}
                      type="button"
                      disabled={controlPending}
                      onClick={() => changeReasoningEffort(effort)}
                      className={cn(
                        "h-6 rounded px-1 text-xs transition",
                        (
                          nativeKernel
                            ? selectedReasoningEffort === effort
                            : profile.source === viewSource &&
                              profile.reasoning_effort === effort
                        )
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {reasoningLabel(effort, locale)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {saveProfile.isError ? (
              <p role="alert" className="px-2 py-2 text-xs text-destructive">
                {saveProfile.error instanceof CoderAPIError &&
                saveProfile.error.status === 401
                  ? copy.authExpired
                  : saveProfile.error instanceof Error
                    ? saveProfile.error.message
                    : copy.unavailable}
              </p>
            ) : null}

            {viewSource === "follow_system" && activeSystemModel ? (
              <ModelContextSetting
                models={systemModels}
                selected={activeSystemModel}
                value={activeSystemSelectionValue}
                disabled={controlPending}
                onChange={selectSystemModel}
                className="mx-1 mt-1 border-t border-border-default px-0.5 pt-1.5"
              />
            ) : null}

            {!nativeKernel && !profileCanExecute(profile) ? (
              <div className="mt-1">
                <ProfileCompatibility profile={profile} compact />
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" /> {copy.loading}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            openCustomModelSetup();
          }}
          className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border-t border-border px-2 pt-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <KeyRoundIcon className="size-3.5" />
          {copy.addCustomModel}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
