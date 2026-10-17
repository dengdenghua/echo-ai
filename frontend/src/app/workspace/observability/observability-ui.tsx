// Small presentational pieces shared by the observability page and panels.

import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";

export function StatTile({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-border-default bg-muted/20 p-3"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold font-mono">{value}</div>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const { t } = useI18n();
  const cls =
    status === "ready"
      ? "bg-success"
      : status === "warming"
        ? "bg-warning"
        : "bg-muted";
  const label =
    status === "ready"
      ? t.observabilityPage.statusReady
      : status === "warming"
        ? t.observabilityPage.statusWarming
        : t.observabilityPage.statusIdle;
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", cls)} />
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
    </div>
  );
}

export function PanelGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="workspace-panel px-5 py-4">
      <div className="mb-4 space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-eyebrow text-muted-foreground">
          {eyebrow}
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
