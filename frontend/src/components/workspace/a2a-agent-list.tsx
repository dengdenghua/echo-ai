import {
  ChevronRightIcon,
  NetworkIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type { RemoteAgent } from "./a2a-agents-types";

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  onRegister,
  showAction,
}: {
  onRegister: () => void;
  showAction: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12">
      <div className="rounded-lg bg-muted/40 p-4">
        <NetworkIcon className="text-muted-foreground size-8" />
      </div>
      <p className="text-muted-foreground text-sm font-medium">
        {t.a2a.noAgents}
      </p>
      <p className="text-muted-foreground text-center text-xs leading-relaxed whitespace-pre-line">
        {t.a2a.noAgentsDesc}
      </p>
      {showAction && (
        <button
          type="button"
          onClick={onRegister}
          className="mt-1 rounded-md border bg-background px-4 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.a2a.registerAgent}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

export function AgentCard({
  agent,
  onClick,
}: {
  agent: RemoteAgent;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const isActive = agent.status === "active";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="bg-card flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all hover:shadow-[var(--shadow-xs)]"
        >
          {/* Status indicator */}
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              isActive ? "bg-success/10" : "bg-destructive/10",
            )}
          >
            {isActive ? (
              <WifiIcon className="size-4 text-success" />
            ) : (
              <WifiOffIcon className="size-4 text-destructive" />
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{agent.name}</span>
              <span className="text-muted-foreground text-xs">
                v{agent.version}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {agent.description || agent.base_url}
            </p>
            {agent.skills.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {agent.skills.slice(0, 3).map((skill) => (
                  <span
                    key={skill.id}
                    className="bg-muted rounded px-1.5 py-0.5 text-xs"
                  >
                    {skill.name}
                  </span>
                ))}
                {agent.skills.length > 3 && (
                  <span className="text-muted-foreground text-xs">
                    +{agent.skills.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>

          <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        <p className="text-xs">{agent.base_url}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.a2a.status}: {agent.status} | {t.a2a.skills}: {agent.skills.length}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
