import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/core/i18n/hooks";
import { desktopStartupCopy } from "@/core/i18n/locales/desktop-startup";

/**
 * First-launch bootstrap gate for the packaged Electron app.
 *
 * The Windows desktop installer ships a fixed PyInstaller backend (see
 * backend-runtime.cjs). While that process is starting, the backend is
 * unreachable, so we show a full-screen overlay instead of a broken shell.
 *
 * Detection: only in the *packaged* shell (`isElectron` + `echo-app:` protocol).
 * Dev mode loads the renderer from the Vite server (http://localhost:3310) and
 * runs the backend externally, so it never triggers this gate.
 *
 * We track readiness rather than the legacy always-200 health endpoint. The
 * progress event remains useful for the unpackaged development smoke path.
 */

interface BootstrapProgress {
  stage?: string;
  message?: string;
}

const HEALTH_POLL_MS = 1500;
const HEALTH_TIMEOUT_MS = 2000;

interface PackagedShellWindow {
  location: { protocol: string };
  echo?: { isElectron?: boolean };
}

export function isPackagedShell(
  shellWindow: PackagedShellWindow | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return (
    !!shellWindow?.echo?.isElectron &&
    shellWindow.location.protocol === "echo-app:"
  );
}

async function backendReady(): Promise<boolean> {
  try {
    // The packaged shell serves the renderer from echo-app://app and
    // reaches the loopback backend only through the protocol proxy's
    // route prefixes. The readiness endpoint lives at the backend root
    // (/readyz, NOT under /api), so request it same-origin relative:
    // packaged → protocol proxy, dev → Vite dev-server proxy.
    const res = await fetch("/readyz", {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function BackendBootstrapOverlay() {
  // null = undetermined (first check pending); true = backend up; false = down.
  const [ready, setReady] = useState<boolean | null>(null);
  // The development bootstrap path may name its current step instead.
  const [message, setMessage] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    const packaged = isPackagedShell();
    if (!packaged) return;

    let active = true;

    const check = async () => {
      const ok = await backendReady();
      if (!active) return;
      setReady(ok);
    };

    // Refine the message when the development-only bootstrap path emits it.
    const off = window.echo?.on(
      "backend:bootstrap-progress",
      (payload: unknown) => {
        const p = payload as BootstrapProgress;
        if (p?.message) setMessage(p.message);
        if (p?.stage === "deps") setPercent(40);
        else if (p?.stage === "optional") setPercent(75);
      },
    );

    // Immediate check (avoids a flash when the backend is already up), then poll.
    void check();
    const timer = setInterval(() => void check(), HEALTH_POLL_MS);

    return () => {
      active = false;
      off?.();
      clearInterval(timer);
    };
  }, []);

  const visible = isPackagedShell() && ready === false;
  if (!visible) return null;

  return <BackendStartupCard message={message} percent={percent} />;
}

/** The startup card itself: what is starting, in the reader's language. */
export function BackendStartupCard({
  message,
  percent,
}: {
  message: string | null;
  percent?: number;
}) {
  const { locale } = useI18n();
  const copy = desktopStartupCopy(locale);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <Card className="w-[min(90vw,420px)] border-none p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            aria-hidden="true"
            className="grid size-10 place-items-center"
            data-testid="backend-startup-mark"
          >
            <img
              alt=""
              className="size-7 dark:hidden"
              src="/brands/codex-blossom-on-light.png"
            />
            <img
              alt=""
              className="hidden size-7 dark:block"
              src="/brands/codex-blossom-on-dark.png"
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {message ?? copy.title}
            </p>
            <p className="text-xs text-muted-foreground">{copy.detail}</p>
          </div>
          {percent !== undefined && (
            <Progress value={percent} className="w-full" />
          )}
        </div>
      </Card>
    </div>
  );
}
