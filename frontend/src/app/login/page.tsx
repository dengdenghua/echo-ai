import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  FingerprintIcon,
  GithubIcon,
  KeyRoundIcon,
  MailIcon,
  UserCircle2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/ui/state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AuthProviderInfo, getAuthProviderInfo } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import {
  authReturnToFromSearch,
  registerPathWithReturnTo,
} from "@/core/auth/return-to";
import { octAuthApi, OctApiError, octErrorMessage } from "@/core/oct/api";
import { useI18n } from "@/core/i18n/hooks";
import { isEmbeddedWindow } from "@/components/workspace/embedded-window-bridge";
import { useAuth } from "@/providers/AuthProvider";
import { toast } from "sonner";

import "./login.css";
import { EchoAgeField } from "./components/EchoAgeField";
import {
  normalizeEmailVerificationCode,
  remainingCooldownSeconds,
} from "./login-utils";

const SMS_COOLDOWN_SECONDS = 60;
const AUTH_PROVIDER_RETRY_COUNT = 5; // 24 → 5
const AUTH_PROVIDER_BASE_DELAY_MS = 500;
const BACKEND_RETRY_BASE_DELAY_MS = 2_000;
const BACKEND_RETRY_MAX_DELAY_MS = 15_000;
const ACCOUNT_FREE_EASTER_EGG_CODE = "093655";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

function EmailLoginForm({ returnTo }: { returnTo: string }) {
  const navigate = useNavigate();
  const { emailLogin, startAccountFreeMode } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const sendingRef = useRef(false);
  const submittingRef = useRef(false);
  const cooldownDeadlineRef = useRef(0);
  const [sendStatus, setSendStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const updateCooldown = () => {
      setCooldown(remainingCooldownSeconds(cooldownDeadlineRef.current));
    };
    const id = window.setInterval(updateCooldown, 500);
    document.addEventListener("visibilitychange", updateCooldown);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", updateCooldown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldown > 0]);

  async function sendCode() {
    if (sendingRef.current || submittingRef.current || cooldown > 0) return;
    const addr = email.trim();
    if (!isValidEmail(addr)) {
      setEmailError(t.auth.errors.invalidEmail);
      setSendStatus(null);
      emailInputRef.current?.focus();
      toast.error(t.auth.errors.invalidEmail);
      return;
    }
    setEmailError(null);
    setSendStatus(null);
    setLoginError(null);
    sendingRef.current = true;
    setSending(true);
    try {
      const r = await octAuthApi.emailSend(addr);
      setSendStatus({
        kind: "success",
        message: `${t.auth.success.emailCodeSent} · ${addr}`,
      });
      toast.success(t.auth.success.emailCodeSent);
      if (r.dev_code) toast.message(t.auth.devCodeNotice(r.dev_code));
      cooldownDeadlineRef.current = Date.now() + SMS_COOLDOWN_SECONDS * 1000;
      setCooldown(SMS_COOLDOWN_SECONDS);
    } catch (err) {
      const message =
        err instanceof OctApiError && err.status === 503
          ? t.auth.errors.gatewayNotEnabled
          : octErrorMessage(err, t.auth.errors.sendFailed);
      setSendStatus({ kind: "error", message });
      if (err instanceof OctApiError && err.status === 503) {
        toast.error(message);
      } else {
        toast.error(message);
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    const trimmedCode = code.trim();
    if (!addr && trimmedCode === ACCOUNT_FREE_EASTER_EGG_CODE) {
      startAccountFreeMode();
      toast.success(t.auth.success.loginSuccess);
      navigate(returnTo, { replace: true });
      return;
    }
    const nextEmailError = !addr
      ? t.auth.errors.emailRequired
      : !isValidEmail(addr)
        ? t.auth.errors.invalidEmail
        : null;
    const nextCodeError = !trimmedCode
      ? t.auth.errors.codeRequired
      : trimmedCode.length !== 6
        ? t.auth.errors.invalidCode
        : null;
    setEmailError(nextEmailError);
    setCodeError(nextCodeError);
    if (nextEmailError || nextCodeError) {
      toast.error(t.auth.errors.emailFillRequired);
      (nextEmailError ? emailInputRef : codeInputRef).current?.focus();
      return;
    }
    if (submittingRef.current || sendingRef.current) return;
    submittingRef.current = true;
    setLoginError(null);
    setSubmitting(true);
    let focusCodeAfterSubmit = false;
    try {
      await emailLogin(addr, trimmedCode);
      toast.success(t.auth.success.loginSuccess);
      navigate(returnTo, { replace: true });
    } catch (err) {
      const message = octErrorMessage(err, t.auth.errors.loginFailed);
      setLoginError(message);
      toast.error(message);
      focusCodeAfterSubmit = true;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      if (focusCodeAfterSubmit) {
        window.setTimeout(() => codeInputRef.current?.focus(), 0);
      }
    }
  }

  return (
    <form
      aria-busy={submitting}
      onSubmit={onSubmit}
      className="echo-login-form space-y-5"
    >
      <div className="space-y-2.5">
        <Label htmlFor="email" className="text-sm font-medium">
          {t.auth.emailLabel}
        </Label>
        <div className="relative">
          <MailIcon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/50" />
          <Input
            aria-describedby={
              emailError
                ? "email-error"
                : sendStatus
                  ? "email-send-feedback"
                  : undefined
            }
            aria-invalid={Boolean(emailError)}
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            ref={emailInputRef}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setSendStatus(null);
              setLoginError(null);
            }}
            disabled={sending || submitting || cooldown > 0}
            autoComplete="email"
            autoFocus
            className="echo-login-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 text-base transition-colors focus:border-primary/40 focus:bg-card aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus-visible:ring-destructive/25"
          />
        </div>
        {emailError && (
          <p
            aria-live="polite"
            className="px-1 text-xs text-destructive"
            id="email-error"
            role="alert"
          >
            {emailError}
          </p>
        )}
      </div>
      <div className="space-y-2.5">
        <Label htmlFor="email-code" className="text-sm font-medium">
          {t.auth.verificationCode}
        </Label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <KeyRoundIcon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/50" />
            <Input
              aria-describedby={
                [
                  codeError ? "email-code-error" : null,
                  loginError ? "email-login-error" : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-invalid={Boolean(codeError)}
              id="email-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              maxLength={6}
              placeholder={t.auth.placeholders.code}
              value={code}
              ref={codeInputRef}
              onChange={(e) => {
                setCode(normalizeEmailVerificationCode(e.target.value));
                setCodeError(null);
                setLoginError(null);
              }}
              disabled={submitting}
              className="echo-login-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 text-base transition-colors focus:border-primary/40 focus:bg-card aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus-visible:ring-destructive/25"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={sendCode}
            disabled={sending || submitting || cooldown > 0}
            className="echo-login-code-button h-12 shrink-0 rounded-xl px-5"
          >
            {cooldown > 0
              ? `${cooldown}s`
              : sending
                ? t.auth.sending
                : t.auth.sendCode}
          </Button>
        </div>
        {codeError && (
          <p
            aria-live="polite"
            className="px-1 text-xs text-destructive"
            id="email-code-error"
            role="alert"
          >
            {codeError}
          </p>
        )}
        {sendStatus && (
          <p
            aria-live="polite"
            className={`px-1 text-xs ${
              sendStatus.kind === "error"
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
            id="email-send-feedback"
            role={sendStatus.kind === "error" ? "alert" : "status"}
          >
            {sendStatus.message}
          </p>
        )}
      </div>
      {loginError && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-sm text-destructive"
          id="email-login-error"
          role="alert"
        >
          {loginError}
        </p>
      )}
      <Button
        type="submit"
        className="echo-login-primary-button h-12 w-full rounded-xl text-base font-medium transition-all"
        disabled={submitting}
      >
        {submitting ? "正在进入 ECHO" : "进入 ECHO"}
        {!submitting && <ArrowRightIcon className="ml-1 size-4" />}
      </Button>
      <p className="px-1 text-center text-xs leading-relaxed text-muted-foreground/70">
        {t.auth.terms.emailAutoRegister}
        {t.auth.terms.agreeTo}{" "}
        <Link
          to="/terms"
          className="text-primary/80 underline-offset-2 transition-colors hover:text-primary hover:underline"
        >
          {t.auth.terms.userAgreement}
        </Link>{" "}
        {t.auth.terms.and}{" "}
        <Link
          to="/privacy"
          className="text-primary/80 underline-offset-2 transition-colors hover:text-primary hover:underline"
        >
          {t.auth.terms.privacyPolicy}
        </Link>
      </p>
    </form>
  );
}

function LocalLoginForm({
  passwordOnlyUsername,
  passwordRequired,
  returnTo,
}: {
  passwordOnlyUsername?: string | null;
  passwordRequired: boolean;
  returnTo: string;
}) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState(() => {
    if (passwordOnlyUsername) return "";
    try {
      return localStorage.getItem("echo:last_local_username") || "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUsername = passwordOnlyUsername || username.trim();
    const hasUserError = !trimmedUsername;
    const hasPassError = passwordRequired && !password;

    setUsernameError(hasUserError ? "请输入用户名" : null);
    setPasswordError(hasPassError ? "请输入密码" : null);

    if (hasUserError || hasPassError) {
      toast.error(hasUserError ? "请输入用户名" : "请输入密码");
      return;
    }
    setLoginError(null);
    setSubmitting(true);
    try {
      await login({
        username: trimmedUsername,
        ...(password ? { password } : {}),
      });
      if (!passwordOnlyUsername) {
        try {
          localStorage.setItem("echo:last_local_username", trimmedUsername);
        } catch {
          // Ignore storage errors
        }
      }
      toast.success(t.auth.success.loginSuccess);
      navigate(returnTo, { replace: true });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t.auth.errors.loginFailed;
      setLoginError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="echo-login-form space-y-5">
      {!passwordOnlyUsername && (
        <>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-xs text-muted-foreground/80">
            {t.loginPage.localBanner}
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="local-username" className="text-sm font-medium">
              {t.registerPage.usernameLabel}
            </Label>
            <div className="relative">
              <UserCircle2Icon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/50" />
              <Input
                aria-invalid={Boolean(usernameError)}
                id="local-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setUsernameError(null);
                  setLoginError(null);
                }}
                placeholder={t.registerPage.usernamePlaceholder}
                autoComplete="username"
                className="echo-login-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 text-base transition-colors focus:border-primary/40 focus:bg-card aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus-visible:ring-destructive/25"
              />
            </div>
            {usernameError && (
              <p
                aria-live="polite"
                className="px-1 text-xs text-destructive"
                id="local-username-error"
                role="alert"
              >
                {usernameError}
              </p>
            )}
          </div>
        </>
      )}
      {passwordRequired && (
        <div className="space-y-2.5">
          <Label htmlFor="local-password" className="text-sm font-medium">
            {t.registerPage.passwordLabel}
          </Label>
          <div className="relative">
            <KeyRoundIcon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/50" />
            <Input
              aria-invalid={Boolean(passwordError)}
              id="local-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
                setLoginError(null);
              }}
              placeholder={t.registerPage.passwordPlaceholder}
              autoComplete="current-password"
              className="echo-login-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 pr-11 text-base transition-colors focus:border-primary/40 focus:bg-card aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus-visible:ring-destructive/25"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOffIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </button>
          </div>
          {passwordError && (
            <p
              aria-live="polite"
              className="px-1 text-xs text-destructive"
              id="local-password-error"
              role="alert"
            >
              {passwordError}
            </p>
          )}
        </div>
      )}
      {loginError && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-sm text-destructive"
          id="local-login-error"
          role="alert"
        >
          {loginError}
        </p>
      )}
      <Button
        type="submit"
        className="echo-login-primary-button h-12 w-full rounded-xl text-base font-medium transition-all"
        disabled={submitting}
      >
        {submitting ? "正在进入 ECHO" : "进入 ECHO"}
        {!submitting && <ArrowRightIcon className="ml-1 size-4" />}
      </Button>
    </form>
  );
}

function EchoBrand() {
  return (
    <div className="echo-login-brand" aria-label="ECHO AGE 回响纪元">
      <span className="echo-login-brand-mark" aria-hidden="true">
        <i />
        <b>E</b>
      </span>
      <span className="echo-login-brand-copy">
        <strong>ECHO AGE</strong>
        <small>回响纪元</small>
      </span>
    </div>
  );
}


export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = authReturnToFromSearch(location.search);
  const [socialProviders, setSocialProviders] = useState<
    Record<string, boolean>
  >({});
  useEffect(() => {
    let active = true;
    fetch(`${getBackendBaseURL()}/api/auth/social/providers`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data?.providers)
          setSocialProviders(
            Object.fromEntries(
              data.providers.map((p: { id: string; enabled: boolean }) => [
                p.id,
                p.enabled,
              ]),
            ),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const { authError, authStatus, isLoading, isAuthenticated, retryAuth } =
    useAuth();
  const { t } = useI18n();
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[] | null>(
    null,
  );
  const [providerReloadKey, setProviderReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthProviders() {
      for (let attempt = 0; attempt < AUTH_PROVIDER_RETRY_COUNT; attempt += 1) {
        const providers = await getAuthProviderInfo();
        if (cancelled) return;
        if (providers.length > 0) {
          setAuthProviders(providers);
          return;
        }
        if (attempt < AUTH_PROVIDER_RETRY_COUNT - 1) {
          // 指数退避：500ms, 1s, 2s, 4s
          const backoffDelay =
            AUTH_PROVIDER_BASE_DELAY_MS * Math.pow(2, attempt);
          await delay(backoffDelay);
        }
      }
      // 5 次后仍为空，停止重试
      setAuthProviders([]);
    }

    void loadAuthProviders();
    return () => {
      cancelled = true;
    };
  }, [providerReloadKey]);

  const providersReady = authProviders !== null;
  const hasOct = authProviders?.some((p) => p.id === "oct") ?? false;
  const localProvider = authProviders?.find((p) => p.id === "local") ?? null;
  const backendUnavailable = authError !== null && authStatus === null;

  // Auto-retry while the backend is unreachable: on a cold start the
  // gateway typically comes up a few seconds after the UI, and requiring
  // a manual click for that routine race is pure friction. Quiet retries
  // keep the error card (and its manual button) on screen instead of
  // flickering the full-screen loading state.
  useEffect(() => {
    if (!backendUnavailable) return;
    let cancelled = false;
    let timer = 0;
    const schedule = (attempt: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void Promise.resolve(retryAuth({ quiet: true })).finally(() => {
          if (!cancelled) schedule(attempt + 1);
        });
      }, Math.min(BACKEND_RETRY_BASE_DELAY_MS * 2 ** attempt, BACKEND_RETRY_MAX_DELAY_MS));
    };
    schedule(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backendUnavailable, retryAuth]);

  const retryBackend = () => {
    setAuthProviders(null);
    setProviderReloadKey((current) => current + 1);
    void retryAuth();
  };

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      navigate(returnTo, { replace: true });
      return;
    }
    if (authStatus && !authStatus.enabled) {
      navigate(returnTo, { replace: true });
    }
  }, [isLoading, isAuthenticated, authStatus, navigate, returnTo]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-sm text-muted-foreground">
          {t.common.loading}
        </div>
      </div>
    );
  }

  if (isAuthenticated || (authStatus && !authStatus.enabled)) {
    return null;
  }

  const embeddedWindow = isEmbeddedWindow();

  return (
    <div
      className={`echo-login-shell relative min-h-screen overflow-hidden${embeddedWindow ? " echo-login-shell-embedded" : ""}`}
    >
      <div className="echo-login-cosmos" aria-hidden="true">
        <div className="echo-login-stars" />
        <div className="echo-login-aurora echo-login-aurora-blue" />
        <div className="echo-login-aurora echo-login-aurora-violet" />
        <EchoAgeField />
      </div>

      <header className="echo-login-header">
        <EchoBrand />
        <nav className="echo-login-header-nav" aria-hidden="true">
          <span>PRODUCT</span>
          <i />
          <span>MEMORY</span>
          <i />
          <span>AGENTS</span>
          <i />
          <span>VISION</span>
        </nav>
        <div className="echo-login-header-status">
          ENTER ECHO
          <span />
        </div>
      </header>

      <main className="echo-login-layout">
        <section className="echo-login-hero" aria-labelledby="echo-login-title">
          <div className="echo-login-eyebrow">THE ECHO ECOSYSTEM</div>
          <h1 id="echo-login-title" className="echo-login-title">
            <span>THE AGE OF</span>
            <strong>ECHO</strong>
          </h1>
          <div className="echo-login-subtitle">
            <span />
            <strong>回响纪元</strong>
            <span />
          </div>
          <p className="echo-login-lead">
            <span>Every interaction leaves an echo.</span>
            <small>每一次交互，都留下回响。</small>
          </p>

          <div className="echo-login-continuum" aria-label="ECHO 能力">
            <div>
              <span>01</span>
              <strong>MEMORY</strong>
              <small>它记住</small>
            </div>
            <i />
            <div>
              <span>02</span>
              <strong>UNDERSTAND</strong>
              <small>它理解</small>
            </div>
            <i />
            <div>
              <span>03</span>
              <strong>ACT</strong>
              <small>它行动</small>
            </div>
            <i />
            <div>
              <span>04</span>
              <strong>GROW</strong>
              <small>它与你共同成长</small>
            </div>
          </div>
        </section>

        <section className="echo-login-form-column" aria-label="ECHO 账号登录">
          <Card className="echo-login-card overflow-hidden rounded-[22px] border-border/50 bg-card/80 backdrop-blur-xl">
            <CardHeader className="space-y-2.5 px-8 pb-6 pt-8 text-center">
              <div className="echo-login-card-kicker">
                <span /> ENTER THE ECHO
              </div>
              <CardTitle className="text-2xl font-medium tracking-tight">
                进入 ECHO
              </CardTitle>
              <CardDescription className="text-[15px] text-muted-foreground/80">
                选择一种方式，登录你的 ECHO 账号
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-7 pt-0">
              {!backendUnavailable && providersReady && (
                <div className="mb-5 space-y-3">
                  {(["google", "github"] as const).map((provider) => (
                    <Button
                      key={provider}
                      variant="outline"
                      className="relative h-12 w-full justify-center gap-3 rounded-xl text-sm font-medium transition-colors hover:bg-accent"
                      disabled={!socialProviders[provider]}
                      title={
                        !socialProviders[provider]
                          ? "此登录方式尚未启用"
                          : undefined
                      }
                      onClick={() => {
                        window.location.assign(
                          `${getBackendBaseURL()}/api/auth/social/${provider}/start?return_to=${encodeURIComponent(returnTo)}`,
                        );
                      }}
                    >
                      {provider === "github" ? (
                        <GithubIcon className="size-5" />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="text-xl font-bold text-blue-600"
                        >
                          G
                        </span>
                      )}
                      使用 {provider === "google" ? "Google" : "GitHub"}{" "}
                      账号继续
                      {!socialProviders[provider] && (
                        <span className="ml-auto text-xs font-normal text-muted-foreground">
                          暂未启用
                        </span>
                      )}
                    </Button>
                  ))}
                  {new URLSearchParams(location.search).has("social_error") && (
                    <p role="alert" className="text-sm text-destructive">
                      第三方登录未完成，请重试或使用邮箱登录。
                    </p>
                  )}
                  <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    或使用其他邮箱
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </div>
              )}
              {backendUnavailable ? (
                <ErrorState
                  className="min-h-40 rounded-xl border border-destructive/20 bg-destructive/5"
                  title="暂时无法连接 Echo 服务"
                  detail="本地服务可能仍在启动或已停止，正在自动重试连接…"
                  actionLabel="重试连接"
                  onAction={retryBackend}
                />
              ) : !providersReady ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                  {t.common.loading}
                </div>
              ) : hasOct && localProvider ? (
                <Tabs
                  defaultValue={
                    localProvider.password_only_username ? "local" : "email"
                  }
                  className="w-full"
                >
                  <TabsList className="mb-6 grid h-11 w-full grid-cols-2 rounded-xl bg-muted/50 p-1">
                    <TabsTrigger
                      value="email"
                      className="rounded-lg text-sm font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm"
                    >
                      邮箱登录
                    </TabsTrigger>
                    <TabsTrigger
                      value="local"
                      className="rounded-lg text-sm font-medium data-[state=active]:bg-card data-[state=active]:shadow-sm"
                    >
                      {localProvider.password_only_username
                        ? t.registerPage.passwordLabel
                        : (localProvider.label ?? "本地账户")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="email" className="mt-0">
                    <EmailLoginForm returnTo={returnTo} />
                  </TabsContent>
                  <TabsContent value="local" className="mt-0">
                    <LocalLoginForm
                      passwordOnlyUsername={
                        localProvider.password_only_username
                      }
                      passwordRequired={
                        localProvider.password_required === true
                      }
                      returnTo={returnTo}
                    />
                  </TabsContent>
                </Tabs>
              ) : hasOct ? (
                <EmailLoginForm returnTo={returnTo} />
              ) : localProvider ? (
                <LocalLoginForm
                  passwordOnlyUsername={localProvider.password_only_username}
                  passwordRequired={localProvider.password_required === true}
                  returnTo={returnTo}
                />
              ) : (
                <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  {t.loginPage.errorServiceDisabled}
                </div>
              )}

              {authStatus?.allow_registration && (
                <div className="mt-6 text-center text-sm text-muted-foreground/80">
                  还没有账户？{" "}
                  <Link
                    to={registerPathWithReturnTo(returnTo)}
                    className="font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    立即注册
                  </Link>
                </div>
              )}

              <div className="echo-login-security-note">
                <FingerprintIcon className="size-3.5" />
                Google、GitHub 或邮箱，选择你习惯的登录方式
              </div>
            </CardContent>
          </Card>

          <p className="echo-login-footer">
            AN AGE BEGINS · © {new Date().getFullYear()} ECHO AGE
          </p>
        </section>
      </main>
    </div>
  );
}
