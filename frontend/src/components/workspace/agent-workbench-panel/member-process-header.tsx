import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftIcon, BotIcon } from "lucide-react";
import { useI18n } from "@/core/i18n/hooks";
import { subagentViewCopy } from "@/core/i18n/locales/subagent-view";
import { cn } from "@/lib/utils";
import { subagentAvatarSrc, type AgentTile } from "../agent-workbench-utils";
import { dockAgentStatusLabel } from "./helpers";

function elapsedLabel(agent: AgentTile, now: number) {
  const live = agent.status === "running" || agent.status === "waiting_approval";
  const ms = live
    ? (agent.startedAt > 0 ? now - agent.startedAt : null)
    : agent.durationMs ??
      (agent.startedAt > 0 && agent.finishedAt !== undefined
        ? agent.finishedAt - agent.startedAt
        : null);
  if (ms === null || !Number.isFinite(ms)) return null;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MemberProcessHeader({
  agent,
  onOpenMain,
  actions,
}: {
  agent: AgentTile;
  onOpenMain: () => void;
  actions?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const copy = subagentViewCopy(locale);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (agent.status !== "running" && agent.status !== "waiting_approval") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [agent.status]);
  const avatar = subagentAvatarSrc(agent.avatarUrl);
  const elapsed = elapsedLabel(agent, now);
  return (
    <header
      className="shrink-0 border-b border-border-subtle bg-background px-3 py-3"
      data-testid="member-process-header"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <button
          type="button"
          onClick={onOpenMain}
          aria-label={copy.backToOverview}
          title={copy.backToOverview}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm">
          {avatar ? (
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            (agent.avatar ?? (
              <BotIcon className="size-4 text-muted-foreground" />
            ))
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-sm font-semibold"
            title={agent.codename ?? agent.name}
          >
            {agent.codename ?? agent.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" role="status">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  agent.status === "running"
                    ? "bg-success motion-safe:animate-pulse"
                    : agent.status === "error"
                      ? "bg-destructive"
                      : agent.status === "waiting_approval"
                        ? "bg-warning"
                        : "bg-muted-foreground/60",
                )}
              />
              {dockAgentStatusLabel(agent.status, t)}
            </span>
            {elapsed && (
              <span
                className="font-mono tabular-nums"
                aria-label={copy.elapsed}
              >
                {elapsed}
              </span>
            )}
          </div>
        </div>
        {actions}
      </div>
      {(agent.taskLabel || agent.task || agent.prompt) && (
        <p className="mt-2 line-clamp-2 break-words pl-[4.75rem] text-xs leading-relaxed text-muted-foreground">
          {agent.task || agent.prompt || agent.taskLabel}
        </p>
      )}
    </header>
  );
}
