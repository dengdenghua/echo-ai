import {
  CircleDashedIcon,
  Loader2Icon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function fixed(value: unknown, digits: number): string {
  return numberOrZero(value).toFixed(digits);
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

export function Pill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "ok" | "warn" | "bad" | "info";
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
    warn: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
    bad: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
    info: "bg-info/15 text-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium uppercase tracking-wider",
        tones[tone],
      )}
    >
      {label}
    </span>
  );
}

export function Bar({
  pct,
  tone,
  label,
}: {
  pct: number;
  tone: "ok" | "warn" | "bad";
  label: string;
}) {
  const color =
    tone === "bad"
      ? "bg-destructive"
      : tone === "warn"
        ? "bg-warning"
        : "bg-success";
  return (
    <div
      className="h-1.5 w-full rounded-lg bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.max(0, pct))}
    >
      <div
        className={cn("h-full rounded-lg transition-all", color)}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-default px-6 py-10 text-center"
      role="status"
    >
      <CircleDashedIcon className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function LoadingRow() {
  const { t } = useI18n();
  return (
    <div
      className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2Icon className="size-3.5 animate-spin" />
      {t.evolutionControl.loadingText}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared Card container
// ---------------------------------------------------------------------------

export function Card({
  title,
  icon,
  children,
  onRefresh,
  loading,
  error,
  headerRight,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  headerRight?: React.ReactNode;
}) {
  const { t } = useI18n();
  const ariaLabelRefresh = t.evolutionControl.refreshAriaLabel;
  return (
    <section className="workspace-panel flex flex-col gap-3 rounded-lg px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-2">
          {headerRight}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-lg p-1 hover:bg-muted"
              aria-label={ariaLabelRefresh}
            >
              <RefreshCwIcon
                className={cn(
                  "size-3.5 text-muted-foreground",
                  loading && "animate-spin",
                )}
              />
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <XCircleIcon className="size-3.5" />
          {error}
        </div>
      )}
      {children}
    </section>
  );
}
