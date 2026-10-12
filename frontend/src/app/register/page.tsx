import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRightIcon,
  KeyRoundIcon,
  MailIcon,
  UserCircle2Icon,
} from "lucide-react";

import {
  EchoAgeFooter,
  EchoAgeHeader,
  EchoAgeShell,
} from "@/components/brand/echo-age";
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
import {
  authReturnToFromSearch,
  loginPathWithReturnTo,
} from "@/core/auth/return-to";
import { useI18n } from "@/core/i18n/hooks";
import { isEmbeddedWindow } from "@/components/workspace/embedded-window-bridge";
import { useAuth } from "@/providers/AuthProvider";
import { toast } from "sonner";

const INPUT_CLASS =
  "echo-age-input h-12 rounded-xl border-border/60 bg-card/50 pl-11 text-base transition-colors focus:border-primary/40 focus:bg-card";
const INPUT_ICON_CLASS =
  "pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/50";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = authReturnToFromSearch(location.search);
  const { t } = useI18n();
  const { register, authStatus, isLoading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 注册被禁用/本地模式时跳转工作区。导航必须放进 effect：渲染期间调用
  // navigate() 会更新 HashRouter 的状态，触发 React 的
  // "Cannot update a component while rendering a different component" 警告。
  const redirectToWorkspace =
    authStatus && (!authStatus.enabled || !authStatus.allow_registration);

  useEffect(() => {
    if (redirectToWorkspace) navigate(returnTo, { replace: true });
  }, [redirectToWorkspace, navigate, returnTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error(t.registerPage.toastFillRequired);
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t.registerPage.toastPasswordMismatch);
      return;
    }
    if (username.length < 3) {
      toast.error(t.registerPage.toastUsernameTooShort);
      return;
    }
    if (password.length < 6) {
      toast.error(t.registerPage.toastPasswordTooShort);
      return;
    }

    setIsSubmitting(true);
    try {
      await register({ username, password, email: email || undefined });
      toast.success(t.registerPage.toastSuccess);
      navigate(loginPathWithReturnTo(returnTo), { replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.registerPage.toastFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-sm text-muted-foreground">
          {t.registerPage.loadingText}
        </div>
      </div>
    );
  }

  if (redirectToWorkspace) return null;

  const features = [
    {
      title: "极速响应",
      desc: "多智能体并行协作，任务秒级启动",
    },
    {
      title: "灵活编排",
      desc: "可视化工作流，自由组合 Agent 能力",
    },
    {
      title: "万物连接",
      desc: "打通微信、钉钉、飞书，消息无缝流转",
    },
  ];
  const embeddedWindow = isEmbeddedWindow();

  return (
    <EchoAgeShell embedded={embeddedWindow}>
      <EchoAgeHeader status="JOIN ECHO" />

      <main className="echo-age-auth-layout">
        <section
          className="echo-age-auth-hero"
          aria-labelledby="echo-register-title"
        >
          <div className="echo-age-eyebrow">THE ECHO ECOSYSTEM</div>
          <h1 id="echo-register-title" className="echo-age-title">
            <span>JOIN THE</span>
            <strong>ECHO</strong>
          </h1>
          <div className="echo-age-subtitle">
            <span />
            <strong>回响纪元</strong>
            <span />
          </div>
          <p className="echo-age-lead">
            <span>加入你的智能角色宇宙</span>
            <small>注册一个账户，让不同角色在 ECHO 上协作、学习与进化。</small>
          </p>

          <ol className="mx-auto mt-11 grid max-w-[620px] grid-cols-3 gap-4 max-[820px]:hidden">
            {features.map((feature, index) => (
              <li
                key={feature.title}
                className="flex flex-col items-center gap-2.5 px-2 text-center"
              >
                <span className="echo-age-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-xs font-medium tracking-[0.08em] text-[#c8cfdf]">
                  {feature.title}
                </span>
                <span className="text-[11px] leading-relaxed text-[#747f98]">
                  {feature.desc}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="echo-age-auth-column"
          aria-labelledby="echo-register-card-title"
        >
          <Card className="echo-age-card overflow-hidden rounded-[22px] border-border/50 bg-card/80 backdrop-blur-xl">
            <CardHeader className="space-y-2.5 px-8 pb-6 pt-8 text-center">
              <div className="echo-age-card-kicker">
                <span /> JOIN THE ECHO
              </div>
              <CardTitle
                id="echo-register-card-title"
                className="text-2xl font-medium tracking-tight"
              >
                创建新账户
              </CardTitle>
              <CardDescription className="text-[15px] text-muted-foreground/80">
                填写以下信息，只需一分钟
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-7 pt-0">
              <form onSubmit={handleSubmit} className="echo-age-form space-y-4">
                <div className="space-y-2.5">
                  <Label htmlFor="username" className="text-sm font-medium">
                    {t.registerPage.usernameLabel}
                  </Label>
                  <div className="relative">
                    <UserCircle2Icon className={INPUT_ICON_CLASS} />
                    <Input
                      id="username"
                      type="text"
                      placeholder={t.registerPage.usernamePlaceholder}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      autoFocus
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="email" className="text-sm font-medium">
                    {t.registerPage.emailLabel}
                  </Label>
                  <div className="relative">
                    <MailIcon className={INPUT_ICON_CLASS} />
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="password" className="text-sm font-medium">
                    {t.registerPage.passwordLabel}
                  </Label>
                  <div className="relative">
                    <KeyRoundIcon className={INPUT_ICON_CLASS} />
                    <Input
                      id="password"
                      type="password"
                      placeholder={t.registerPage.passwordPlaceholder}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <div className="space-y-2.5">
                  <Label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium"
                  >
                    {t.registerPage.confirmPasswordLabel}
                  </Label>
                  <div className="relative">
                    <KeyRoundIcon className={INPUT_ICON_CLASS} />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder={t.registerPage.confirmPasswordPlaceholder}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="echo-age-primary-button h-12 w-full rounded-xl text-base font-medium transition-all"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? t.registerPage.submitting
                    : t.registerPage.submitButton}
                  {!isSubmitting && <ArrowRightIcon className="ml-1 size-4" />}
                </Button>
              </form>
              <div className="mt-6 text-center text-sm text-muted-foreground/80">
                已有账户？{" "}
                <Link
                  to={loginPathWithReturnTo(returnTo)}
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  立即登录
                </Link>
              </div>
            </CardContent>
          </Card>

          <EchoAgeFooter />
        </section>
      </main>
    </EchoAgeShell>
  );
}
