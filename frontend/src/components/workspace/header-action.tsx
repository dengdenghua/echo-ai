import type { ReactElement, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Shared geometry and feedback for the conversation header's compact actions. */
export const headerActionClass =
  "header-icon-hit-area inline-flex h-[42px] min-w-[42px] shrink-0 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-xs font-normal text-muted-foreground shadow-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-muted/60 data-[state=open]:text-foreground sm:h-8 sm:min-w-8";

export function HeaderActionTooltip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={400} disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8} className="max-w-72">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
