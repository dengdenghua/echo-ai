/**
 * Codex in model settings: which connection Codex runs on (the system model
 * or a ChatGPT / Codex account), signing that account in and out, and what it
 * allows.
 */
import { supportedReasoningEfforts } from "@/core/models/execution-capabilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  LogOutIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelCoderLogin,
  CoderAPIError,
  coderQueryKeys,
  getCoderAccount,
  getCoderApps,
  getCoderModelProfile,
  getCoderModels,
  getCoderRateLimits,
  getCoderUsage,
  logoutCoderAccount,
  startCoderLogin,
  updateCoderApps,
  updateCoderModelProfile,
  type CoderLoginResult,
  type CoderLoginType,
} from "@/core/coder/api";
import { useI18n } from "@/core/i18n/hooks";
import { coderEngineCopy } from "@/core/i18n/locales/coder-engine";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";

import { CoderAccountDetails, CoderAccountLogin } from "./coder-account-panels";
import {
  isSystemOrchestratorModel,
  openSensitiveAuthorizationUrl,
  profileCanExecute,
  profileProblem,
} from "./coder-engine-profile";

export function CoderEngineSettings({
  conversationDefaultModel,
  conversationDefaultLabel,
  accountSetupRequest = 0,
  authorizationOnly = false,
}: {
  conversationDefaultModel?: string;
  conversationDefaultLabel?: string;
  accountSetupRequest?: number;
  authorizationOnly?: boolean;
} = {}) {
  const { locale } = useI18n();
  const copy = coderEngineCopy(locale);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const principalKey = user?.actor_id || user?.user_id || "local";
  const queryKeys = useMemo(() => coderQueryKeys(principalKey), [principalKey]);
  const [activeLogin, setActiveLogin] = useState<CoderLoginResult | null>(null);
  const [accountSetupOpen, setAccountSetupOpen] = useState(false);
  useEffect(() => {
    if (accountSetupRequest > 0) setAccountSetupOpen(true);
  }, [accountSetupRequest]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loginBusy, setLoginBusy] = useState<
    CoderLoginType | "cancel" | "logout" | null
  >(null);
  const loginStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const activeLoginRef = useRef<CoderLoginResult | null>(null);
  const dismissedLoginErrorRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Login is backend-owned and intentionally survives renderer reloads or
      // settings-route unmounts. The next instance rehydrates the opaque id;
      // only the explicit Cancel/Logout controls terminate the operation.
    };
  }, []);

  const profileQuery = useQuery({
    queryKey: queryKeys.profile,
    queryFn: ({ signal }) => getCoderModelProfile(signal),
    staleTime: 30_000,
  });
  const accountQuery = useQuery({
    queryKey: queryKeys.account,
    queryFn: ({ signal }) => getCoderAccount(signal),
    staleTime: 5_000,
  });
  const refetchAccount = accountQuery.refetch;
  const profile = profileQuery.data;
  const loginPending = Boolean(accountQuery.data?.login_pending || activeLogin);
  const showAccountPanel =
    authorizationOnly ||
    profile?.source === "codex_account" ||
    accountSetupOpen ||
    loginPending;

  useEffect(() => {
    const state = accountQuery.data;
    if (
      state?.login_error &&
      state.login_error !== dismissedLoginErrorRef.current
    ) {
      setLoginError(state.login_error);
    }
    if (state?.login_pending && state.login_id && !activeLoginRef.current) {
      // Login operations outlive a renderer reload. Rehydrate the opaque id
      // from the backend so polling and explicit cancellation remain
      // available without persisting an OAuth URL or device code locally.
      const recovered: CoderLoginResult = {
        type: "chatgpt",
        login_id: state.login_id,
      };
      activeLoginRef.current = recovered;
      loginStartedAtRef.current = 0;
      setActiveLogin(recovered);
      setAccountSetupOpen(true);
    }
  }, [accountQuery.data]);
  const modelsQuery = useQuery({
    queryKey: queryKeys.models,
    queryFn: ({ signal }) => getCoderModels(signal),
    enabled:
      !authorizationOnly &&
      showAccountPanel &&
      Boolean(accountQuery.data?.account),
    staleTime: 60_000,
  });
  const hasChatGPTUsage =
    showAccountPanel && accountQuery.data?.account?.type === "chatgpt";
  const rateLimitsQuery = useQuery({
    queryKey: queryKeys.rateLimits,
    queryFn: ({ signal }) => getCoderRateLimits(signal),
    enabled: hasChatGPTUsage,
    staleTime: 30_000,
    refetchInterval: hasChatGPTUsage ? 60_000 : false,
  });
  const usageQuery = useQuery({
    queryKey: queryKeys.usage,
    queryFn: ({ signal }) => getCoderUsage(signal),
    enabled: hasChatGPTUsage,
    staleTime: 5 * 60_000,
  });
  const appsQuery = useQuery({
    queryKey: queryKeys.apps,
    queryFn: ({ signal }) => getCoderApps(signal),
    enabled: hasChatGPTUsage,
    staleTime: 60_000,
  });
  const saveApps = useMutation({
    scope: { id: "coder-app-selection" },
    mutationFn: updateCoderApps,
    onSuccess: (apps) => queryClient.setQueryData(queryKeys.apps, apps),
    onError: (error) => {
      setLoginError(error instanceof Error ? error.message : String(error));
    },
  });
  const saveProfile = useMutation({
    scope: { id: `coder-model-profile:${principalKey}` },
    mutationFn: updateCoderModelProfile,
    onMutate: () => {
      setLoginError(null);
      setLoginNotice(null);
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(queryKeys.profile, profile);
      setAccountSetupOpen(false);
      setLoginNotice(
        profileCanExecute(profile) ? copy.saved : copy.savedUnavailable,
      );
    },
  });

  const completeAccountLogin = useCallback(async () => {
    activeLoginRef.current = null;
    setActiveLogin(null);
    setLoginNotice(copy.loginComplete);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.models }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rateLimits }),
      queryClient.invalidateQueries({ queryKey: queryKeys.usage }),
      queryClient.invalidateQueries({ queryKey: queryKeys.apps }),
    ]);
    if (!authorizationOnly) {
      const profile = await updateCoderModelProfile({
        source: "codex_account",
      });
      queryClient.setQueryData(queryKeys.profile, profile);
    }
  }, [
    authorizationOnly,
    copy.loginComplete,
    queryClient,
    queryKeys.apps,
    queryKeys.models,
    queryKeys.profile,
    queryKeys.rateLimits,
    queryKeys.usage,
  ]);

  useEffect(() => {
    if (!activeLogin?.login_id) return;
    let stopped = false;
    const poll = async () => {
      const result = await refetchAccount();
      if (stopped) return;
      const state = result.data;
      const expected = activeLogin.type === "apiKey" ? "apiKey" : "chatgpt";
      if (
        state?.account?.type === expected &&
        !state.login_pending &&
        Date.now() - loginStartedAtRef.current > 500
      ) {
        try {
          await completeAccountLogin();
        } catch (error) {
          setLoginError(error instanceof Error ? error.message : String(error));
        }
      } else if (
        state &&
        !state.login_pending &&
        !state.account &&
        Date.now() - loginStartedAtRef.current > 500
      ) {
        // App Server reports failed/cancelled login completion by clearing the
        // pending id. Do not retain the stale renderer operation forever.
        activeLoginRef.current = null;
        setActiveLogin(null);
        setLoginError(state.login_error || copy.loginFailed);
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeLogin, completeAccountLogin, copy.loginFailed, refetchAccount]);

  const beginLogin = async (type: CoderLoginType, apiKey?: string) => {
    dismissedLoginErrorRef.current = null;
    setLoginBusy(type);
    setLoginError(null);
    setLoginNotice(null);
    setCopied(false);
    try {
      const result = await startCoderLogin(type, apiKey);
      loginStartedAtRef.current = Date.now();
      if (type === "apiKey") {
        if (!mountedRef.current) return;
        await accountQuery.refetch();
        await completeAccountLogin();
        setLoginNotice(copy.apiKeyConnected);
        return;
      }
      if (!mountedRef.current) {
        // The backend operation may have committed after this renderer went
        // away. Leave it intact so a replacement renderer can rehydrate it.
        return;
      }
      activeLoginRef.current = result;
      setActiveLogin(result);
      setLoginNotice(copy.loginStarted);
      const url = result.auth_url || result.verification_url;
      if (url) await openSensitiveAuthorizationUrl(url);
    } catch (error) {
      if (mountedRef.current) {
        setLoginError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mountedRef.current) setLoginBusy(null);
    }
  };

  const submitApiKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const key = String(new FormData(form).get("api_key") ?? "").trim();
    // Clear the DOM immediately. The key is never copied into React state,
    // browser storage, a URL, telemetry, or a log message.
    form.reset();
    if (key) void beginLogin("apiKey", key);
  };

  const cancelLogin = async () => {
    if (!activeLogin?.login_id) return;
    setLoginBusy("cancel");
    setLoginError(null);
    try {
      const cancelled = await cancelCoderLogin(activeLogin.login_id);
      activeLoginRef.current = null;
      setActiveLogin(null);
      if (cancelled) {
        setLoginNotice(copy.loginCancelled);
      } else {
        setLoginError(copy.loginFailed);
      }
      const result = await accountQuery.refetch();
      if (cancelled) {
        dismissedLoginErrorRef.current = result.data?.login_error || null;
        setLoginError(null);
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusy(null);
    }
  };

  const logout = async () => {
    setLoginBusy("logout");
    setLoginError(null);
    try {
      await logoutCoderAccount();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      // Logout resets the model preference server-side before touching the
      // account. Always discard optimistic/stale account state, even when the
      // remote logout operation reports a recoverable failure.
      activeLoginRef.current = null;
      setActiveLogin(null);
      queryClient.removeQueries({ queryKey: queryKeys.models });
      queryClient.removeQueries({ queryKey: queryKeys.rateLimits });
      queryClient.removeQueries({ queryKey: queryKeys.usage });
      queryClient.removeQueries({ queryKey: queryKeys.apps });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.account }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
      ]);
      setLoginBusy(null);
    }
  };

  const account = accountQuery.data?.account;
  const currentModel =
    modelsQuery.data?.models.find(
      (model) => model.id === profile?.effective_model,
    ) ??
    modelsQuery.data?.models.find((model) => model.is_default) ??
    null;
  const reasoningOptions = supportedReasoningEfforts(currentModel);
  const busy = saveProfile.isPending || loginBusy !== null;
  const chatDefault = conversationDefaultModel?.trim() || "";
  const chatDefaultUsesAccount = /^chatgpt[/:]/i.test(chatDefault);
  const chatDefaultModel = chatDefaultUsesAccount
    ? chatDefault.replace(/^chatgpt[/:]/i, "")
    : chatDefault;
  const chatDefaultSource = chatDefaultUsesAccount
    ? "codex_account"
    : "follow_system";
  const canUseChatDefault = Boolean(
    chatDefaultModel &&
    !["auto", "default", "inherit", "follow_system"].includes(
      chatDefaultModel.toLowerCase(),
    ) &&
    !isSystemOrchestratorModel(chatDefaultModel) &&
    (!chatDefaultUsesAccount || account?.type === "chatgpt"),
  );
  const matchesChatDefault =
    profile?.source === chatDefaultSource &&
    (profile?.selected_model || profile?.effective_model) === chatDefaultModel;
  const executionAvailable = profile ? profileCanExecute(profile) : false;
  const error =
    saveProfile.error instanceof CoderAPIError &&
    saveProfile.error.status === 401
      ? copy.authExpired
      : saveProfile.error
        ? saveProfile.error instanceof Error
          ? saveProfile.error.message
          : String(saveProfile.error)
        : showAccountPanel
          ? loginError
          : null;
  const notice =
    showAccountPanel ||
    loginNotice === copy.saved ||
    loginNotice === copy.savedUnavailable
      ? loginNotice
      : null;

  return (
    <section
      data-testid="coder-engine-settings"
      className="rounded-lg border border-border bg-card/45 p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">
              {authorizationOnly ? copy.account : copy.title}
            </h2>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                (authorizationOnly || profile?.source === "codex_account") &&
                  account
                  ? "bg-success/10 text-success"
                  : loginPending
                    ? "bg-info/10 text-info"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {!authorizationOnly && profile?.source === "follow_system"
                ? copy.systemConnection
                : account
                  ? copy.accountConnected
                  : loginPending
                    ? copy.pending
                    : copy.notConnected}
            </span>
          </div>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted-foreground">
            {authorizationOnly
              ? {
                  "zh-CN":
                    "这里只管理授权。使用账号还是系统 API，请在对话输入框中选择。",
                  "en-US":
                    "Manage authorization here. Choose this account or a system API in the conversation composer.",
                  "ja-JP":
                    "ここでは認証のみを管理します。アカウントとシステム API は入力欄で選択できます。",
                  "ko-KR":
                    "여기서는 인증만 관리합니다. 계정 또는 시스템 API는 대화 입력창에서 선택하세요.",
                }[locale]
              : copy.subtitle}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={
            profileQuery.isError || accountQuery.isError ? "outline" : "ghost"
          }
          aria-label={copy.retry}
          title={copy.retry}
          onClick={() => {
            void profileQuery.refetch();
            void accountQuery.refetch();
            if (account) void modelsQuery.refetch();
            if (hasChatGPTUsage) {
              void rateLimitsQuery.refetch();
              void usageQuery.refetch();
              void appsQuery.refetch();
            }
          }}
          disabled={profileQuery.isFetching || accountQuery.isFetching}
        >
          <RefreshCwIcon
            className={cn(
              "size-3.5",
              (profileQuery.isFetching || accountQuery.isFetching) &&
                "animate-spin",
            )}
          />
          {profileQuery.isError || accountQuery.isError ? copy.retry : null}
        </Button>
      </div>

      {profileQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> {copy.loading}
        </div>
      ) : profileQuery.isError || !profile ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/20 bg-destructive/[0.04] p-3 text-sm text-destructive"
        >
          {copy.loadFailed}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {!authorizationOnly && (
            <>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {copy.sourceTitle}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={profile.source === "follow_system"}
                    disabled={busy || loginPending}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition",
                      profile.source === "follow_system"
                        ? "border-primary/40 bg-primary/[0.07] ring-1 ring-primary/15"
                        : "border-border hover:border-border-strong hover:bg-muted/30",
                    )}
                    onClick={() => {
                      setAccountSetupOpen(false);
                      setLoginError(null);
                      setLoginNotice(null);
                      if (profile.source !== "follow_system") {
                        saveProfile.mutate({ source: "follow_system" });
                      }
                    }}
                  >
                    <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {copy.followSystem}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {copy.followSystemDescription}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={profile.source === "codex_account"}
                    aria-expanded={!account ? showAccountPanel : undefined}
                    disabled={busy || loginPending}
                    className={cn(
                      "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                      profile.source === "codex_account"
                        ? "border-primary/40 bg-primary/[0.07] ring-1 ring-primary/15"
                        : "border-border hover:border-border-strong hover:bg-muted/30",
                    )}
                    onClick={() => {
                      if (account) {
                        saveProfile.mutate({ source: "codex_account" });
                      } else {
                        dismissedLoginErrorRef.current =
                          accountQuery.data?.login_error || null;
                        setLoginError(null);
                        setLoginNotice(null);
                        setAccountSetupOpen(true);
                      }
                    }}
                  >
                    <UserRoundIcon className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {copy.accountMode}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {copy.accountModeDescription}
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/45 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {profile.compatible
                    ? copy.activeSummary(
                        profile.effective_model ||
                          (profile.source === "codex_account"
                            ? currentModel?.id || copy.modelDefault
                            : copy.systemDefault),
                      )
                    : copy.pendingModel}
                </span>
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-1.5 font-medium",
                    executionAvailable ? "text-success" : "text-warning",
                  )}
                >
                  {executionAvailable ? (
                    <CheckCircle2Icon className="size-3.5" />
                  ) : (
                    <AlertTriangleIcon className="size-3.5" />
                  )}
                  {executionAvailable ? copy.compatible : copy.unavailable}
                </span>
                <details className="basis-full text-muted-foreground">
                  <summary className="cursor-pointer select-none text-xs hover:text-foreground">
                    {copy.technicalDetails}
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
                    <span>
                      {copy.systemModel}{" "}
                      <code className="text-foreground/80">
                        {profile.system_model || "—"}
                      </code>
                    </span>
                    <span>
                      {copy.provider}{" "}
                      <code className="text-foreground/80">
                        {profile.provider || "—"}
                      </code>
                    </span>
                  </div>
                </details>
              </div>
              {profileProblem(profile, locale) ? (
                <p className="text-xs text-warning">
                  {profileProblem(profile, locale)}
                </p>
              ) : null}
              {canUseChatDefault && !matchesChatDefault ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto max-w-full whitespace-normal text-left"
                  disabled={busy}
                  onClick={() =>
                    saveProfile.mutate({
                      source: chatDefaultSource,
                      model: chatDefaultModel,
                    })
                  }
                >
                  {copy.useChatDefault(
                    conversationDefaultLabel || chatDefaultModel,
                  )}
                </Button>
              ) : null}

              {showAccountPanel &&
              !account &&
              profile.source === "follow_system" ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {copy.accountSetupHint}
                </p>
              ) : null}
            </>
          )}
          {showAccountPanel ? (
            accountQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">{copy.loading}</p>
            ) : accountQuery.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {copy.loadFailed}
              </p>
            ) : account ? (
              <div className="space-y-3">
                <div
                  className={cn(
                    "grid gap-3 rounded-lg bg-muted/25 p-3 sm:items-end",
                    authorizationOnly
                      ? "sm:grid-cols-[1fr_auto]"
                      : "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CheckCircle2Icon className="size-4 text-success" />
                      {copy.account}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {copy.accountSummary(
                        account.email || "",
                        account.plan_type || account.type,
                      )}
                    </div>
                  </div>
                  {!authorizationOnly && (
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>{copy.model}</span>
                      <Select
                        value={
                          profile.source === "codex_account"
                            ? profile.effective_model || "__default__"
                            : "__default__"
                        }
                        disabled={busy || modelsQuery.isLoading}
                        onValueChange={(model) =>
                          saveProfile.mutate({
                            source: "codex_account",
                            ...(model === "__default__" ? {} : { model }),
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-full"
                          aria-label={copy.model}
                        >
                          <SelectValue placeholder={copy.modelDefault} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            {copy.modelDefault}
                          </SelectItem>
                          {(modelsQuery.data?.models ?? []).map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.display_name || model.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  {!authorizationOnly && reasoningOptions.length > 0 ? (
                    <label className="space-y-1.5 text-xs text-muted-foreground">
                      <span>{copy.reasoning}</span>
                      <Select
                        value={profile.reasoning_effort || "__default__"}
                        disabled={busy || reasoningOptions.length === 0}
                        onValueChange={(reasoning) =>
                          saveProfile.mutate({
                            source: "codex_account",
                            model: profile.effective_model || undefined,
                            reasoning_effort:
                              reasoning === "__default__" ? null : reasoning,
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-full"
                          aria-label={copy.reasoning}
                        >
                          <SelectValue placeholder={copy.reasoningDefault} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            {copy.reasoningDefault}
                          </SelectItem>
                          {reasoningOptions.map((reasoning) => (
                            <SelectItem key={reasoning} value={reasoning}>
                              {reasoning}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void logout()}
                  >
                    <LogOutIcon className="size-3.5" /> {copy.logout}
                  </Button>
                </div>

                <CoderAccountDetails
                  copy={copy}
                  locale={locale}
                  hasChatGPTUsage={hasChatGPTUsage}
                  apps={appsQuery.data?.apps ?? []}
                  appsLoading={appsQuery.isLoading}
                  savingApps={saveApps.isPending}
                  onSaveApps={(selected) => saveApps.mutate(selected)}
                  rateLimits={rateLimitsQuery.data}
                  usage={usageQuery.data}
                />
              </div>
            ) : (
              <CoderAccountLogin
                copy={copy}
                busy={busy}
                loginPending={loginPending}
                loginBusy={loginBusy}
                activeLogin={activeLogin}
                copied={copied}
                onCopied={setCopied}
                authorizationOnly={authorizationOnly}
                onBeginLogin={(type) => void beginLogin(type)}
                onCancelLogin={() => void cancelLogin()}
                onSubmitApiKey={submitApiKey}
              />
            )
          ) : null}

          {error ? (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/20 bg-destructive/[0.04] p-3 text-xs text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" /> {error}
            </div>
          ) : null}
          {notice ? (
            <div
              role="status"
              className={cn(
                "flex gap-2 rounded-lg border p-3 text-xs",
                notice === copy.savedUnavailable
                  ? "border-warning/20 bg-warning/[0.04] text-warning"
                  : "border-success/20 bg-success/[0.04] text-success",
              )}
            >
              {notice === copy.savedUnavailable ? (
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />
              )}
              {notice}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
