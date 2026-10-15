import { CloudOffIcon, RotateCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { SquareProgressLine } from "./square-host";

/** Loading: one thin core line over a muted label (BRAND.md). */
export function SquareLoading({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex min-h-40 w-full flex-col items-center justify-center gap-3",
        className,
      )}
    >
      <SquareProgressLine className="w-28" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * The Square could not be reached. Same message as the phone's
 * 「暂时连不上广场」: say what happened, then offer the one thing to do.
 */
export function SquareOffline({
  title,
  description,
  retryLabel,
  onRetry,
  className,
}: {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-square-offline=""
      className={cn(
        "flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border-default px-6 py-8 text-center",
        className,
      )}
    >
      <CloudOffIcon
        aria-hidden="true"
        strokeWidth={1.5}
        className="size-6 text-muted-foreground"
      />
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border-default px-3 py-1.5 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
      >
        <RotateCwIcon
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-3.5"
        />
        {retryLabel}
      </button>
    </div>
  );
}

export function SquareEmpty({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-40 w-full items-center justify-center px-6 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A selectable pill (topics, market categories). */
export function SquarePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-150",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border-subtle text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
