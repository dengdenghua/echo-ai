import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/core/i18n/hooks";
import { desktopStartupCopy } from "@/core/i18n/locales/desktop-startup";
import { useStartupGate } from "@/core/backend/use-startup-gate";

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

export function BackendBootstrapOverlay() {
  const visible = useStartupGate(isPackagedShell());
  // The development bootstrap path may name its current step instead.
  const [message, setMessage] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | undefined>(undefined);

  useEffect(() => {
    const packaged = isPackagedShell();
    if (!packaged) return;

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

    return () => {
      off?.();
    };
  }, []);

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
          <div className="size-8 animate-pulse rounded-full bg-primary/60" />
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
