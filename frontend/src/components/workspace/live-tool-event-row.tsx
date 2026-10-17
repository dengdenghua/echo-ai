import {
  CheckCircle2Icon,
  CircleStopIcon,
  ChevronDownIcon,
  XCircleIcon,
  Loader2Icon,
  TerminalIcon,
  FileEditIcon,
  SearchIcon,
  GlobeIcon,
  EyeIcon,
  GitBranchIcon,
  BrainCircuitIcon,
  ShieldAlertIcon,
  RefreshCwIcon,
  ListChecksIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { cn } from "@/lib/utils";

import {
  agentRunBadgeClass,
  agentRunStatusLightPulseClass,
} from "./agent-run-status";
import {
  asRecord,
  compactMiddle,
  extractSearchResults,
  formatDetailBlock,
  formatInputSummary,
  formatOutputSummary,
  getContentPreview,
  type SearchResultItem,
} from "./live-tool-timeline-format";
import {
  codeLogText,
  detailTitle,
  researchAdjustmentSummary,
  researchLogText,
  statusText,
  swarmLogText,
} from "./live-tool-timeline-log-text";
import type { LiveToolEvent, TimelineT } from "./live-tool-timeline-types";
import { ToolResourceReferences } from "./messages/tool-resource-references";

const TOOL_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  bash: { icon: TerminalIcon, color: "text-chart-8" },
  exec_shell: { icon: TerminalIcon, color: "text-chart-8" },
  shell_command: { icon: TerminalIcon, color: "text-chart-8" },
  write_file: { icon: FileEditIcon, color: "text-chart-6" },
  write_text_file: { icon: FileEditIcon, color: "text-chart-6" },
  create_file: { icon: FileEditIcon, color: "text-chart-6" },
  edit_code: { icon: FileEditIcon, color: "text-chart-6" },
  edit_text_file: { icon: FileEditIcon, color: "text-chart-6" },
  str_replace: { icon: FileEditIcon, color: "text-chart-6" },
  read_file: { icon: EyeIcon, color: "text-chart-2" },
  read_text_file: { icon: EyeIcon, color: "text-chart-2" },
  fetch_url: { icon: GlobeIcon, color: "text-chart-7" },
  list_cwd: { icon: SearchIcon, color: "text-chart-1" },
  glob: { icon: SearchIcon, color: "text-chart-1" },
  grep: { icon: SearchIcon, color: "text-chart-1" },
  todo_write: { icon: ListChecksIcon, color: "text-chart-1" },
  call_agent: { icon: BrainCircuitIcon, color: "text-chart-6" },
  call_agent_parallel: { icon: BrainCircuitIcon, color: "text-chart-6" },
  bb_read: { icon: BrainCircuitIcon, color: "text-chart-6" },
  bb_write: { icon: BrainCircuitIcon, color: "text-chart-6" },
  bb_keys: { icon: BrainCircuitIcon, color: "text-chart-6" },
  "deep-research-swarm": { icon: BrainCircuitIcon, color: "text-chart-1" },
  "report-writing": { icon: FileEditIcon, color: "text-chart-6" },
  docx: { icon: FileEditIcon, color: "text-chart-6" },
  web_search: { icon: GlobeIcon, color: "text-chart-7" },
  apply_skill: { icon: BrainCircuitIcon, color: "text-chart-1" },
  list_learned_skills: { icon: BrainCircuitIcon, color: "text-chart-1" },
  learn_skill_from_text: { icon: BrainCircuitIcon, color: "text-chart-1" },
  planning: { icon: BrainCircuitIcon, color: "text-chart-6" },
  agent_thought: { icon: BrainCircuitIcon, color: "text-chart-1" },
  team_swarm: { icon: BrainCircuitIcon, color: "text-chart-6" },
  team_routing: { icon: BrainCircuitIcon, color: "text-chart-6" },
  git_status: { icon: GitBranchIcon, color: "text-chart-4" },
  git_commit: { icon: GitBranchIcon, color: "text-chart-4" },
  git_diff: { icon: GitBranchIcon, color: "text-chart-4" },
  stream_recovery: { icon: RefreshCwIcon, color: "text-chart-6" },
  model_gateway: { icon: BrainCircuitIcon, color: "text-chart-6" },
  model_reasoning: { icon: BrainCircuitIcon, color: "text-chart-1" },
};

function statusClassName(status: LiveToolEvent["status"]): string {
  return agentRunBadgeClass(status);
}

function InlineSummaryRow({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "result";
}) {
  return (
    <div
      className={cn(
        "mt-1 ml-5 flex min-w-0 items-start gap-2 border-l pl-2 text-xs leading-4",
        tone === "result"
          ? "border-success/25 text-success/85"
          : "border-border-default text-muted-foreground/85",
      )}
    >
      <span className="shrink-0 rounded-sm bg-muted/60 px-1.5 py-0.5 font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words line-clamp-2">{value}</span>
    </div>
  );
}

export function ToolEventRow({
  event,
  toolLabels,
  t,
  showAgent,
  nested,
}: {
  event: LiveToolEvent;
  toolLabels: Record<string, string>;
  t: TimelineT;
  showAgent?: boolean;
  nested?: boolean;
}) {
  // Tool names carry suffixes the icon map doesn't (grep_text→grep,
  // glob_files→glob) — fall back to the normalized base before the generic
  // icon so search/file/shell steps stay visually distinct.
  const iconCfg = TOOL_ICONS[event.name] ??
    TOOL_ICONS[event.name.toLowerCase().replace(/_text/g, "")] ??
    TOOL_ICONS[event.name.toLowerCase().replace(/_files?$/, "")] ?? {
      icon: TerminalIcon,
      color: "text-muted-foreground",
    };
  const label = toolLabels[event.name] ?? t.liveTools.genericAction;
  const Icon = iconCfg.icon;
  const modelReasoningOutput = (() => {
    if (event.name !== "model_reasoning") return undefined;
    const outputRecord = asRecord(event.output);
    if (typeof outputRecord?.content === "string") return outputRecord.content;
    return typeof event.output === "string" ? event.output : undefined;
  })();
  const isSystemWorkLogEvent =
    event.name === "turn_request" ||
    event.name === "stream_connection" ||
    event.name === "response_stream" ||
    event.name === "model_gateway" ||
    event.name === "model_reasoning";
  const inputSummary = formatInputSummary(event.input);
  const outputSummary = formatOutputSummary(event.output);
  const inputDetail = isSystemWorkLogEvent
    ? undefined
    : formatDetailBlock(event.input);
  const outputDetail =
    event.name === "model_reasoning"
      ? modelReasoningOutput
      : isSystemWorkLogEvent
        ? undefined
        : formatDetailBlock(event.output);
  const thoughtDetail = formatDetailBlock(event.thought);
  const observationDetail = formatDetailBlock(event.observation);
  const contentPreview = isSystemWorkLogEvent
    ? undefined
    : getContentPreview(event);
  const researchSummary = researchAdjustmentSummary(event, t);
  const researchLog = researchLogText(event, t);
  const searchResults =
    event.name === "web_search" && event.status !== "running"
      ? extractSearchResults(event.output)
      : [];
  const swarmLog = researchLog ? null : swarmLogText(event, t);
  const codeLog = researchLog || swarmLog ? null : codeLogText(event, t);
  const [open, setOpen] = useState(
    event.status === "running" || event.status === "error",
  );
  useEffect(() => {
    if (event.status === "running" || event.status === "error") setOpen(true);
  }, [event.id, event.status]);
  const inlineInputSummary =
    inputSummary &&
    !researchLog &&
    !isSystemWorkLogEvent &&
    inputSummary !== codeLog?.detail
      ? inputSummary
      : undefined;
  const inlineOutputSummary =
    outputSummary &&
    !researchLog &&
    !isSystemWorkLogEvent &&
    event.status !== "running"
      ? outputSummary
      : undefined;
  const hasDetails = Boolean(
    inputDetail ||
    outputDetail ||
    thoughtDetail ||
    observationDetail ||
    contentPreview,
  );

  return (
    <div
      className={cn(
        "relative transition-all duration-base",
        nested ? "py-1 pl-2 text-xs" : "py-1.5 pl-2 text-xs",
        event.status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        {event.status === "running" ? (
          <Loader2Icon className="size-3.5 animate-spin text-success shrink-0" />
        ) : event.status === "waiting_approval" ? (
          <ShieldAlertIcon className="size-3.5 text-warning shrink-0 animate-pulse" />
        ) : event.status === "error" ? (
          <XCircleIcon className="size-3.5 text-destructive shrink-0" />
        ) : event.status === "interrupted" ? (
          <CircleStopIcon className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <CheckCircle2Icon className="size-3.5 text-success shrink-0" />
        )}

        <Icon className={cn("size-3.5 shrink-0", iconCfg.color)} />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {researchLog?.label ?? swarmLog?.label ?? codeLog?.label ?? label}
        </span>

        {showAgent && event.agentName && (
          <span className="text-muted-foreground text-xs">
            · {event.agentName}
          </span>
        )}

        {researchLog?.sources && researchLog.sources.length > 0 && (
          <span className="flex min-w-0 items-center gap-1">
            {Array.from(new Set(researchLog.sources))
              .slice(0, 3)
              .map((source) => (
                <span
                  key={source}
                  className="max-w-20 truncate rounded-full border border-border-default bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground"
                  title={source}
                >
                  {source}
                </span>
              ))}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-xs font-medium",
              agentRunStatusLightPulseClass(event.status) ?? "",
              statusClassName(event.status),
            )}
          >
            {statusText(event, t)}
          </span>

          {event.status === "done" &&
            event.durationMs != null &&
            event.durationMs >= 1 && (
              <span className="text-muted-foreground text-xs">
                {event.durationMs < 1000
                  ? `${event.durationMs}ms`
                  : `${(event.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}

          {hasDetails && (
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={() => setOpen((value) => !value)}
              aria-label={
                open
                  ? t.liveToolTimeline.collapseToolDetails
                  : t.liveToolTimeline.expandToolDetails
              }
              title={
                open
                  ? t.liveToolTimeline.collapseToolDetails
                  : t.liveToolTimeline.expandToolDetails
              }
            >
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform",
                  open ? "rotate-180" : "rotate-0",
                )}
              />
            </button>
          )}
        </span>
      </div>

      {!researchLog && (
        <ToolResourceReferences input={event.input} output={event.output} />
      )}
      {researchLog?.detail && (
        <div className="mt-2 ml-5 border-l border-border-default pl-3 text-sm leading-6 text-foreground/80">
          {researchLog.detail}
        </div>
      )}

      {searchResults.length > 0 && (
        <SearchResultsInline results={searchResults} t={t} />
      )}

      {swarmLog?.detail && (
        <div className="mt-2 ml-5 border-l border-chart-6/25 pl-3 text-sm leading-6 text-foreground/80">
          {swarmLog.detail}
        </div>
      )}

      {codeLog?.detail && (
        <div className="mt-1 ml-5 break-words border-l border-border-default pl-3 text-sm leading-6 text-foreground/75">
          {codeLog.detail}
        </div>
      )}

      {thoughtDetail && event.name !== "agent_thought" && (
        <div className="mt-1 ml-5 border-l border-chart-1/25 pl-2 text-xs leading-5 text-chart-1">
          <span className="font-medium">{detailTitle(t, "thought")}: </span>
          {compactMiddle(thoughtDetail, 260)}
        </div>
      )}

      {observationDetail && (
        <div className="mt-1 ml-5 border-l border-success/25 pl-2 text-xs leading-5 text-success">
          <span className="font-medium">{detailTitle(t, "observation")}: </span>
          {compactMiddle(observationDetail, 260)}
        </div>
      )}

      {inlineInputSummary && (
        <InlineSummaryRow
          label={t.liveToolTimeline.detailTitles.input}
          value={inlineInputSummary}
        />
      )}

      {inlineOutputSummary && (
        <InlineSummaryRow
          label={t.liveToolTimeline.detailTitles.result}
          value={inlineOutputSummary}
          tone="result"
        />
      )}

      {researchSummary && !researchLog && (
        <div className="mt-1 ml-5 border-l border-chart-6/25 pl-2 text-xs leading-4 text-chart-6">
          {researchSummary}
        </div>
      )}

      {open && inputDetail && (
        <div className="mt-2 ml-5 overflow-hidden border-l border-border-default pl-2">
          <div className="pb-1 text-xs font-medium text-muted-foreground">
            {detailTitle(t, "input")}
          </div>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/35 px-2 py-1.5 font-mono text-xs leading-4 text-foreground/80">
            {inputDetail}
          </pre>
        </div>
      )}

      {open && thoughtDetail && (
        <div className="mt-2 ml-5 overflow-hidden border-l border-chart-1/25 pl-2">
          <div className="pb-1 text-xs font-medium text-muted-foreground">
            {detailTitle(t, "thought")}
          </div>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-chart-1/5 px-2 py-1.5 font-mono text-xs leading-4 text-foreground/80">
            {thoughtDetail}
          </pre>
        </div>
      )}

      {open &&
        outputDetail &&
        (event.status !== "running" || event.name === "model_reasoning") && (
          <div className="mt-2 ml-5 overflow-hidden border-l border-success/25 pl-2">
            <div className="pb-1 text-xs font-medium text-muted-foreground">
              {event.name === "model_reasoning"
                ? detailTitle(t, "publicReasoning")
                : detailTitle(t, "result")}
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-success/5 px-2 py-1.5 font-mono text-xs leading-4 text-foreground/80">
              {outputDetail}
            </pre>
          </div>
        )}

      {open && observationDetail && (
        <div className="mt-2 ml-5 overflow-hidden border-l border-success/25 pl-2">
          <div className="pb-1 text-xs font-medium text-muted-foreground">
            {detailTitle(t, "observation")}
          </div>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-success/5 px-2 py-1.5 font-mono text-xs leading-4 text-foreground/80">
            {observationDetail}
          </pre>
        </div>
      )}

      {open && contentPreview && (
        <div className="mt-2 ml-5 overflow-hidden border-l border-border-default pl-2">
          <div className="pb-1 text-xs font-medium text-muted-foreground">
            {detailTitle(t, "preview")}
          </div>
          <pre className="max-h-36 overflow-hidden whitespace-pre-wrap break-words py-1 font-mono text-xs leading-4 text-foreground/80">
            {contentPreview}
          </pre>
        </div>
      )}
    </div>
  );
}

function SearchResultsInline({
  results,
  t,
}: {
  results: SearchResultItem[];
  t: TimelineT;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsedCount = 5;
  const visibleResults = expanded ? results : results.slice(0, collapsedCount);
  const hiddenCount = Math.max(0, results.length - visibleResults.length);
  return (
    <div className="mt-2 ml-5 space-y-1 border-l border-border-default pl-3">
      {visibleResults.map((result, index) => (
        <div
          key={`${result.url ?? result.title}-${index}`}
          className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground"
        >
          <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {index + 1}
          </span>
          {result.url ? (
            <RoutedWebLink
              href={result.url}
              openTargetSource="tool-search-result"
              className="min-w-0 truncate text-foreground/75 underline-offset-2 hover:text-foreground hover:underline"
              title={result.title}
            >
              {result.title}
            </RoutedWebLink>
          ) : (
            <span
              className="min-w-0 truncate text-foreground/75"
              title={result.title}
            >
              {result.title}
            </span>
          )}
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          <ChevronDownIcon className="size-3" />
          {t.liveToolTimeline.showMoreResults(hiddenCount)}
        </button>
      )}
      {expanded && results.length > collapsedCount && (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          onClick={() => setExpanded(false)}
        >
          <ChevronDownIcon className="size-3 rotate-180" />
          {t.liveToolTimeline.collapseResults}
        </button>
      )}
    </div>
  );
}
