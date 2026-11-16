import { useEffect, useRef, useState } from "react";
import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import { ErrorState } from "@/components/ui/state";
import { useI18n } from "@/core/i18n/hooks";
import { desktopStartupCopy } from "@/core/i18n/locales/desktop-startup";

/** A failed HTTP probe cannot tell whether the local process is still booting. */
export function LoginServiceStatus({
  unavailable,
  onRetry,
}: {
  unavailable: boolean;
  onRetry: () => void;
}) {
  const { locale, t } = useI18n();
  const copy = desktopStartupCopy(locale);
  const desktop = window.echo?.isElectron === true;
  const [failed, setFailed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const getStatus = window.echo?.backend?.getStatus;
    if (!desktop || !getStatus) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const current = epoch.current;
      try {
        const status = await getStatus();
        if (active && current === epoch.current)
          setFailed(status.state === "failed");
      } catch {
        // Missing IPC or a probe failure is not evidence of a crashed process.
      }
      if (active) timer = setTimeout(() => void check(), 1500);
    };
    void check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [desktop]);
  const restart = async () => {
    epoch.current += 1;
    setRestarting(true);
    try {
      const result = await window.echo?.backend?.restart();
      if (result?.ok) {
        setFailed(false);
        onRetry();
      }
    } catch {
      // Retain the confirmed failure and its retry action if IPC rejects.
    } finally {
      epoch.current += 1;
      setRestarting(false);
    }
  };
  if (desktop && (!failed || restarting)) {
    return (
      <div data-testid="login-service-wait" className="min-h-40">
        <BrandLoadingPanel label={copy.title} description={copy.detail} />
      </div>
    );
  }
  if (!desktop && !unavailable) {
    return <BrandLoadingPanel label={t.common.loading} className="min-h-40" />;
  }
  return (
    <ErrorState
      className="min-h-40 rounded-xl border border-destructive/20 bg-destructive/5"
      title={desktop ? copy.failedTitle : copy.unavailableTitle}
      detail={desktop ? copy.failedDetail : copy.unavailableDetail}
      actionLabel={
        restarting ? copy.checking : desktop ? copy.restart : copy.retry
      }
      onAction={
        restarting ? undefined : desktop ? () => void restart() : onRetry
      }
    />
  );
}
