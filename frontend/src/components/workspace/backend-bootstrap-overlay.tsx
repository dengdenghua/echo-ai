import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { EchoBrandMark } from "@/components/brand/echo-brand-mark";
import { BrandProgressLine } from "@/components/brand/brand-progress";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/core/i18n/hooks";
import { desktopStartupCopy } from "@/core/i18n/locales/desktop-startup";
import { useStartupGate } from "@/core/backend/use-startup-gate";
import { isPackagedShell } from "@/core/backend/desktop-shell";
export { isPackagedShell } from "@/core/backend/desktop-shell";

/**
 * First-launch bootstrap gate for the packaged Electron app.
 *
 * The Windows desktop installer ships a fixed PyInstaller backend (see
 * backend-runtime.cjs). While that process is starting, the backend is
 * unreachable, so a small status notice accompanies the sign-in surface.
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

export function BackendBootstrapOverlay() {
  const { pathname } = useLocation();
  const loginRoute = pathname === "/" || pathname.replace(/\/+$/, "") === "/login";
  const startup = useStartupGate(isPackagedShell() && !loginRoute);
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

  if (!startup.visible) return null;

  return (
    <BackendStartupCard
      message={message}
      percent={percent}
      slow={startup.slow}
      checking={startup.checking}
      onRetry={startup.retry}
    />
  );
}

/** The startup card itself: what is starting, in the reader's language. */
export function BackendStartupCard({
  message,
  percent,
  slow = false,
  checking = false,
  onRetry,
}: {
  message: string | null;
  percent?: number;
  slow?: boolean;
  checking?: boolean;
  onRetry?: () => void;
}) {
  const { locale } = useI18n();
  const { pathname } = useLocation();
  const copy = desktopStartupCopy(locale);
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex justify-center"
      data-testid="desktop-startup-notice"
      data-echo-theme={
        ["/", "/login", "/register"].includes(pathname) ? "graphite" : undefined
      }
    >
      <section
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-sm"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <EchoBrandMark size="sm" breathe />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {message ?? copy.title}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {slow ? copy.slowDetail : copy.detail}
            </p>
          </div>
          {slow && onRetry && (
            <button
              type="button"
              disabled={checking}
              className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
              onClick={onRetry}
            >
              {checking ? copy.checking : copy.retry}
            </button>
          )}
        </div>
        {percent !== undefined ? (
          <Progress value={percent} className="h-0.5 w-full" />
        ) : (
          <BrandProgressLine />
        )}
      </section>
    </div>
  );
}
