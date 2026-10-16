import {
  ArrowLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
  Loader2Icon,
} from "lucide-react";
import { useState } from "react";

import { PersonaGlyph } from "@/components/brand/persona-glyph";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";
import {
  type AgentTile,
  type DiffEntry,
  DIFF_TAB_LABEL,
  roleDescription,
  subagentAvatarSrc,
} from "./agent-workbench-utils";
import { friendlyRoleName } from "./agent-workbench-block-helpers";
import { StatusGlyph, WorkbenchEmptyPage } from "./agent-workbench-primitives";
import { basename } from "./agent-workbench-references";

// The summary page, its rows, the observed-reference model and the block
// helpers live in sibling modules; re-exported so existing imports still work.
export { StatusGlyph, WorkbenchEmptyPage };
export { AgentSummaryPage } from "./agent-summary-page";
export { buildObservedReferenceTabs } from "./agent-workbench-references";
export {
  agentTileForBlock,
  findAgentTileByFocusId,
  friendlyRoleName,
  isAgentCreationBlock,
  isAgentLifecycleBlock,
  pickCurrentScreenFrame,
} from "./agent-workbench-block-helpers";

export function AgentCreationCard({
  agent,
  agentStatusClass,
  agentStatusLabel,
}: {
  agent: AgentTile;
  agentStatusClass: (status: AgentTile["status"]) => string;
  agentStatusLabel: (status: AgentTile["status"]) => string;
}) {
  const { t } = useI18n();
  const [showBrief, setShowBrief] = useState(false);
  const displayName = agent.codename ?? agent.name;
  // The role's name/说明 come from the backend built-in role catalog
  // (BUILTIN_ROLES) when the spawn resolved to a known role; free-form role
  // labels fall back to the frontend name/description maps. The delegated
  // brief (task/prompt) is work info — only a last-resort fill so the card
  // never renders empty.
  const roleName =
    agent.roleDisplayName ?? friendlyRoleName(agent.role ?? agent.name);
  const roleBrief =
    agent.roleDescription ?? roleDescription(agent.role ?? agent.name);
  const fullBrief =
    roleBrief ?? agent.prompt ?? agent.task ?? agent.lastThought ?? "";
  const motto =
    roleBrief ??
    agent.task ??
    agent.prompt ??
    agent.lastThought ??
    agent.currentTool ??
    t.agentWorkbenchPages.defaultMotto;
  const active = agent.status === "running";
  const waiting = agent.status === "waiting_approval";

  return (
    <section className="overflow-hidden rounded-lg border border-border-default bg-background shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-center border-b border-border-subtle px-3 py-2 text-sm font-medium text-muted-foreground">
        {t.agentWorkbenchPages.agentClusterCreateAssistant}
      </div>
      <div className="flex justify-center overflow-hidden bg-[color:color-mix(in_oklab,var(--muted)_38%,var(--background))] px-7 pb-8 pt-16">
        <div className="relative w-full max-w-sm rotate-[3deg] transition-transform duration-slow hover:rotate-0">
          <div
            aria-hidden="true"
            className="absolute -top-20 left-1/2 z-10 h-24 w-12 -translate-x-1/2 rounded-b-lg border-x border-border-default bg-foreground shadow-[var(--shadow-xs)]"
          />
          <div
            aria-hidden="true"
            className="absolute -top-3 left-1/2 z-20 h-5 w-16 -translate-x-1/2 rounded-full border-4 border-foreground bg-background"
          />
          <div className="relative min-h-[28rem] rounded-lg border border-border-default bg-background px-5 py-5">
            {showBrief ? (
              <div className="flex h-full min-h-[25rem] flex-col">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowBrief(false)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t.agentWorkbenchPages.backToRoleCard}
                    title={t.agentWorkbenchPages.backToRoleCard}
                  >
                    <ChevronRightIcon className="size-4 rotate-180" />
                  </button>
                  <div className="min-w-0 flex-1 text-center text-xl font-semibold text-foreground">
                    {t.agentWorkbenchPages.roleDescription}
                  </div>
                  <span className="w-8" aria-hidden="true" />
                </div>
                <div className="mt-6 flex items-center gap-3 rounded-lg bg-muted/35 px-3 py-2">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-xl">
                    {subagentAvatarSrc(agent.avatarUrl) ? (
                      <img
                        src={subagentAvatarSrc(agent.avatarUrl) as string}
                        alt=""
                        className="size-full rounded-full object-cover"
                      />
                    ) : (
                      <PersonaGlyph name={displayName} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {displayName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {roleName}
                    </div>
                  </div>
                  <span className="ml-auto font-mono text-sm text-foreground">
                    {agent.label}
                  </span>
                </div>
                <div className="mt-5 max-h-72 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-base leading-7 text-foreground">
                  {fullBrief || t.agentWorkbenchPages.noFullRoleDescription}
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-md bg-foreground px-3 py-2 text-base font-semibold text-background">
                  {displayName}
                </div>
                <div className="mt-12 flex size-28 items-center justify-center rounded-lg border border-border bg-muted/20">
                  {subagentAvatarSrc(agent.avatarUrl) ? (
                    <img
                      src={subagentAvatarSrc(agent.avatarUrl) as string}
                      alt=""
                      className="size-full rounded-lg object-cover"
                    />
                  ) : (
                    <PersonaGlyph name={displayName} className="text-5xl" />
                  )}
                </div>
                <div className="mt-8 text-2xl font-semibold tracking-normal text-foreground">
                  {roleName}
                </div>
                <p className="mt-3 line-clamp-3 text-base leading-7 text-muted-foreground">
                  {motto}
                </p>
                <div className="my-5 border-t border-dashed border-border" />
                <div className="flex items-end gap-3">
                  <div className="text-3xl font-bold tracking-normal text-foreground">
                    ECHO
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBrief(true)}
                    className="ml-auto rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-85"
                    title={t.agentWorkbenchPages.roleDescription}
                  >
                    {t.agentWorkbenchPages.roleDescription}
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
                      agentStatusClass(agent.status),
                      active
                        ? "bg-success/10"
                        : waiting
                          ? "bg-warning/10"
                          : "bg-muted",
                    )}
                  >
                    {active && <Loader2Icon className="size-3 animate-spin" />}
                    {agent.status === "done" && agent.role === "cowork"
                      ? t.message.statusResponded
                      : agentStatusLabel(agent.status)}
                  </span>
                  {agent.iterationCount !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {t.agentWorkbenchPages.iterationRound(
                        agent.iterationCount,
                      )}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function DiffText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-5 text-foreground/80">
      {lines.map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={cn(
            "block min-h-5",
            line.startsWith("+") &&
              !line.startsWith("+++") &&
              "bg-success/10 text-success",
            line.startsWith("-") &&
              !line.startsWith("---") &&
              "bg-destructive/10 text-destructive",
            (line.startsWith("@@") ||
              line.startsWith("diff --git") ||
              line.startsWith("+++") ||
              line.startsWith("---")) &&
              "text-muted-foreground",
          )}
        >
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function AgentDiffPage({
  entries,
  onBackToSummary,
}: {
  entries: DiffEntry[];
  onBackToSummary?: () => void;
}) {
  const { t } = useI18n();
  if (entries.length === 0) {
    return (
      <WorkbenchEmptyPage
        title={DIFF_TAB_LABEL}
        description={t.agentWorkbenchPages.noDiffEntriesDescription}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background/70 p-3">
      <div className="mx-auto w-full max-w-2xl space-y-3">
        {onBackToSummary && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToSummary}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3.5" />
              {t.agentWorkbenchPages.dashboardOverview}
            </button>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {DIFF_TAB_LABEL}
            </span>
          </div>
        )}
        {entries.map((entry) => (
          <section
            key={entry.id}
            className="overflow-hidden rounded-lg border border-border-default bg-background/85 shadow-[var(--shadow-xs)]"
          >
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <StatusGlyph status={entry.status} />
              <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
              <span
                className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
                title={entry.path}
              >
                {basename(entry.title || entry.path)}
              </span>
            </div>
            <DiffText text={entry.text} />
          </section>
        ))}
      </div>
    </div>
  );
}
