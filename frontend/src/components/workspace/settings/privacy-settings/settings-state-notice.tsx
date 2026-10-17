import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { getSettingsUxCopy } from "../settings-ux-copy";

import type { LoadState } from "./privacy-types";

export function SettingsStateNotice({
  state,
  copy,
  onRetry,
  compact = false,
}: {
  state: Exclude<LoadState, "ready"> | "ready";
  copy: Pick<
    ReturnType<typeof getSettingsUxCopy>["privacy"],
    "loading" | "loadFailed" | "retry"
  >;
  onRetry: () => void | Promise<void>;
  compact?: boolean;
}) {
  if (state === "ready") return null;
  const failed = state === "error";
  if (!failed) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={copy.loading}
        className={cn("mt-3 space-y-2", compact && "mt-2")}
      >
        <span className="block h-2.5 w-2/3 animate-pulse rounded-full bg-muted" />
        {!compact ? (
          <span className="block h-2.5 w-2/5 animate-pulse rounded-full bg-muted/70" />
        ) : null}
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 text-xs",
        compact ? "border-transparent bg-transparent px-0 py-1" : "py-3",
        "border-destructive/25 bg-destructive/5 text-destructive",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span>{copy.loadFailed}</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={() => void onRetry()}
      >
        {copy.retry}
      </Button>
    </div>
  );
}
