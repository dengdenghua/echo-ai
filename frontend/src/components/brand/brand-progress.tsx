import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The ECHO loading indicator (BRAND.md: "加载用一条细的 core 进度线"): a 2px
 * track with an indeterminate `core` segment. Under prefers-reduced-motion
 * the segment stops and the whole line holds steady at reduced strength.
 * Decorative by itself; pair it with a status label (see BrandLoadingPanel).
 */
export function BrandProgressLine({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-echo-progress=""
      className={cn(
        "relative block h-0.5 w-full overflow-hidden rounded-full bg-[var(--echo-core-soft)]",
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-2/5 rounded-full bg-[var(--echo-core)]",
          "animate-[echo-progress-slide_1.4s_cubic-bezier(0.2,0.8,0.2,1)_infinite]",
          "motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60",
        )}
      />
    </span>
  );
}

/**
 * Placeholder for a route or a whole panel that is still loading: a short
 * progress line over a muted label. `fill` stretches it over its parent.
 */
export function BrandLoadingPanel({
  label,
  description,
  className,
  hideLabel = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  /** Keep the label for assistive tech only (e.g. fast route switches). */
  hideLabel?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-echo-loading=""
      className={cn(
        "flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-3 px-4 text-center",
        className,
      )}
    >
      <BrandProgressLine className="w-28" />
      <span
        className={cn("text-sm text-muted-foreground", hideLabel && "sr-only")}
      >
        {label}
      </span>
      {description ? (
        <span className="max-w-sm text-xs text-muted-foreground">
          {description}
        </span>
      ) : null}
    </div>
  );
}

/** A full-width line pinned to the top edge of the viewport or a panel. */
export function BrandTopProgress({
  fixed = false,
  className,
}: {
  fixed?: boolean;
  className?: string;
}) {
  return (
    <BrandProgressLine
      className={cn(
        "inset-x-0 top-0 z-50 rounded-none",
        fixed ? "fixed" : "absolute",
        className,
      )}
    />
  );
}
