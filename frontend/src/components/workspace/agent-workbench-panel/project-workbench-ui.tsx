"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionTitle({
  icon,
  title,
  meta,
  titleId,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  titleId?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <h4
        id={titleId}
        className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
      >
        {title}
      </h4>
      {meta ? (
        <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-5 py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border border-border-default bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
      <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "default" | "warning";
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-xl border bg-card/60 p-2.5 text-left shadow-[var(--shadow-xs)]",
        tone === "warning" && "border-warning/30 bg-warning/[0.05]",
        onClick &&
          "transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground",
          tone === "warning" && "bg-warning/10 text-warning",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold">
          {value}
        </span>
      </span>
    </Comp>
  );
}

export function RetroMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-background/70 px-1.5 py-2">
      <div className="text-xs font-semibold">{value}</div>
      <div className="mt-0.5 text-micro text-muted-foreground">{label}</div>
    </div>
  );
}
