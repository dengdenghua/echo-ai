import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  UserCircle2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthProviderInfo } from "@/core/auth/api";
import { useAuth } from "@/providers/AuthProvider";

import { loginErrorMessage } from "./login-utils";

const INPUT_CLASS =
  "echo-login-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 text-base transition-colors focus:border-primary/40 focus:bg-card aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus-visible:ring-destructive/25";
const NOTE_CLASS =
  "rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-xs text-muted-foreground/80";
const USERNAME_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const PASSWORD_MIN_LENGTH = 8;

function errorText(err: unknown): string {
  return loginErrorMessage(err, (e) =>
    e instanceof Error ? e.message : "登录失败，请重试",
  );
}

/** The desktop shell signs its owner in automatically; this brings them back
 * after an explicit logout or a failed automatic attempt. */
export function DesktopOwnerLogin() {
  const { desktopLogin } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      await desktopLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "本机登录失败，请重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mb-5 space-y-3">
      <Button
        className="relative h-12 w-full justify-center gap-3 rounded-xl text-sm font-medium"
        disabled={pending}
        onClick={() => void signIn()}
      >
        <UserCircle2Icon className="size-5" />
        以本机账户继续
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        或使用 ECHO 账户登录
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: typeof KeyRoundIcon;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
        {children}
      </div>
      {error && (
        <p
          aria-live="polite"
          className="px-1 text-xs text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  autoComplete: string;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Input
        aria-invalid={invalid}
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${INPUT_CLASS} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        tabIndex={-1}
      >
        {visible ? (
          <EyeOffIcon className="size-4" />
        ) : (
          <EyeIcon className="size-4" />
        )}
      </button>
    </>
  );
}

function FormError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p
      aria-live="assertive"
      className="rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-sm text-destructive"
      id={id}
      role="alert"
    >
      {message}
    </p>
  );
}

/** First run of a self-hosted install: the setup code creates the owner. */
function OwnerSetupForm({
  provider,
  returnTo,
}: {
  provider: AuthProviderInfo;
  returnTo: string;
}) {
  const navigate = useNavigate();
  const { setupOwner } = useAuth();
  const ids = useId();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    const next = {
      code: code.trim() ? null : "请输入设置码",
      username: !trimmed
        ? "请输入用户名"
        : USERNAME_RE.test(trimmed)
          ? null
          : "用户名只能包含字母、数字和 . _ @ -",
      password:
        password.length >= PASSWORD_MIN_LENGTH
          ? null
          : `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`,
      confirm: confirm === password ? null : "两次输入的密码不一致",
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;
    setSubmitting(true);
    try {
      await setupOwner({
        username: trimmed,
        password,
        setup_code: code.trim(),
      });
      toast.success("本机账户已创建");
      void navigate(returnTo, { replace: true });
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  const clear = (key: string) => {
    setErrors((prev) => ({ ...prev, [key]: null }));
    setFormError(null);
  };

  return (
    <form onSubmit={onSubmit} className="echo-login-form space-y-5" noValidate>
      <div className={NOTE_CLASS}>
        <p>
          首次使用：用启动 ECHO AI
          时显示的设置码创建本机账户。这个账户管理这台服务器，只能在本机或局域网内登录。
        </p>
        <p className="mt-1.5 break-all">
          设置码也保存在{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
            {provider.setup_code_path ?? "数据目录/auth/owner-setup-code.txt"}
          </code>
        </p>
      </div>
      <Field
        id={`${ids}-code`}
        label="设置码"
        icon={ShieldCheckIcon}
        error={errors.code}
      >
        <Input
          aria-invalid={Boolean(errors.code)}
          id={`${ids}-code`}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            clear("code");
          }}
          placeholder="XXXX-XXXX-XXXX"
          lang="en"
          autoComplete="one-time-code"
          spellCheck={false}
          className={`${INPUT_CLASS} font-mono uppercase tracking-wider`}
        />
      </Field>
      <Field
        id={`${ids}-username`}
        label="用户名"
        icon={UserCircle2Icon}
        error={errors.username}
      >
        <Input
          aria-invalid={Boolean(errors.username)}
          id={`${ids}-username`}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            clear("username");
          }}
          placeholder="例如 ada"
          autoComplete="username"
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        id={`${ids}-password`}
        label="密码"
        icon={KeyRoundIcon}
        error={errors.password}
      >
        <PasswordInput
          id={`${ids}-password`}
          value={password}
          onChange={(value) => {
            setPassword(value);
            clear("password");
          }}
          invalid={Boolean(errors.password)}
          autoComplete="new-password"
          placeholder={`至少 ${PASSWORD_MIN_LENGTH} 个字符`}
        />
      </Field>
      <Field
        id={`${ids}-confirm`}
        label="确认密码"
        icon={KeyRoundIcon}
        error={errors.confirm}
      >
        <PasswordInput
          id={`${ids}-confirm`}
          value={confirm}
          onChange={(value) => {
            setConfirm(value);
            clear("confirm");
          }}
          invalid={Boolean(errors.confirm)}
          autoComplete="new-password"
          placeholder="再输入一次密码"
        />
      </Field>
      <FormError id={`${ids}-error`} message={formError} />
      <Button
        type="submit"
        className="echo-login-primary-button h-12 w-full rounded-xl text-base font-medium transition-all"
        disabled={submitting}
      >
        {submitting ? "正在创建本机账户" : "创建本机账户并进入"}
        {!submitting && <ArrowRightIcon className="ml-1 size-4" />}
      </Button>
    </form>
  );
}

function OwnerLoginForm({
  provider,
  returnTo,
}: {
  provider: AuthProviderInfo;
  returnTo: string;
}) {
  const navigate = useNavigate();
  const { login } = useAuth();
  const ids = useId();
  const [username, setUsername] = useState(provider.owner_username ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    const next = {
      username: trimmed ? null : "请输入用户名",
      password: password ? null : "请输入密码",
    };
    setErrors(next);
    setFormError(null);
    if (next.username || next.password) return;
    setSubmitting(true);
    try {
      await login({ username: trimmed, password });
      toast.success("登录成功");
      void navigate(returnTo, { replace: true });
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="echo-login-form space-y-5" noValidate>
      <div className={NOTE_CLASS}>
        这台服务器的本机账户，只能在本机或局域网内登录。
      </div>
      <Field
        id={`${ids}-username`}
        label="用户名"
        icon={UserCircle2Icon}
        error={errors.username}
      >
        <Input
          aria-invalid={Boolean(errors.username)}
          id={`${ids}-username`}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setErrors((prev) => ({ ...prev, username: null }));
            setFormError(null);
          }}
          autoComplete="username"
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        id={`${ids}-password`}
        label="密码"
        icon={KeyRoundIcon}
        error={errors.password}
      >
        <PasswordInput
          id={`${ids}-password`}
          value={password}
          onChange={(value) => {
            setPassword(value);
            setErrors((prev) => ({ ...prev, password: null }));
            setFormError(null);
          }}
          invalid={Boolean(errors.password)}
          autoComplete="current-password"
          placeholder="输入本机账户密码"
        />
      </Field>
      <FormError id={`${ids}-error`} message={formError} />
      <Button
        type="submit"
        className="echo-login-primary-button h-12 w-full rounded-xl text-base font-medium transition-all"
        disabled={submitting}
      >
        {submitting ? "正在进入 ECHO" : "进入 ECHO"}
        {!submitting && <ArrowRightIcon className="ml-1 size-4" />}
      </Button>
      <p className="px-1 text-xs text-muted-foreground">
        忘记密码：在服务器上删除数据目录里的 auth/local-owner.json
        并重启，再用新的设置码重新创建。
      </p>
    </form>
  );
}

/** Sign-in for a self-hosted install's owner account (setup on first run). */
export function OwnerAccountForm({
  provider,
  returnTo,
}: {
  provider: AuthProviderInfo;
  returnTo: string;
}) {
  return provider.owner_setup_required ? (
    <OwnerSetupForm provider={provider} returnTo={returnTo} />
  ) : (
    <OwnerLoginForm provider={provider} returnTo={returnTo} />
  );
}
