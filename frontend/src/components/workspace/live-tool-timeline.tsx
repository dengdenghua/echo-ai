"use client";

import {
  CheckCircle2Icon,
  CircleStopIcon,
  XCircleIcon,
  Loader2Icon,
  BrainCircuitIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { emitAgentWorkbenchFocus } from "./agent-workbench-events";
import { ToolEventRow } from "./live-tool-event-row";
import { getToolLabels } from "./live-tool-timeline-log-text";
import type { LiveToolEvent, TimelineT } from "./live-tool-timeline-types";
import { getProcessTraceEvents } from "./process-trace-events";
import { SwarmRunOverview } from "./swarm-run-overview";

export type { LiveToolEvent };

function workflowEvents(events: LiveToolEvent[]): LiveToolEvent[] {
  return getProcessTraceEvents(events);
}

function getVisibleEvents(events: LiveToolEvent[]): LiveToolEvent[] {
  const topLevel = workflowEvents(events).filter((e) => !e.parentToolUseId);
  const runningEvents = topLevel
    .filter(
      (event) =>
        event.status === "running" || event.status === "waiting_approval",
    )
    .sort((a, b) => a.startedAt - b.startedAt);
  const recentFinishedEvents = topLevel
    .filter((event) => event.status !== "running")
    .sort(
      (a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt),
    )
    .slice(0, runningEvents.length > 0 ? 2 : 4);

  return [...runningEvents, ...recentFinishedEvents];
}

function getAllVisibleEvents(events: LiveToolEvent[]): LiveToolEvent[] {
  return workflowEvents(events)
    .filter((event) => !event.parentToolUseId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function getRunningEvents(events: LiveToolEvent[]): LiveToolEvent[] {
  return workflowEvents(events)
    .filter((event) => !event.parentToolUseId && event.status === "running")
    .sort((a, b) => a.startedAt - b.startedAt);
}

function getChildren(
  events: LiveToolEvent[],
  parentId: string,
): LiveToolEvent[] {
  return events
    .filter((e) => e.parentToolUseId === parentId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function LiveToolTimeline({
  events,
  className,
  groupByAgent,
  runningOnly = false,
  showAll = false,
  compactDelegations = false,
}: {
  events: LiveToolEvent[];
  className?: string;
  groupByAgent?: boolean;
  runningOnly?: boolean;
  showAll?: boolean;
  compactDelegations?: boolean;
}) {
  const { t } = useI18n();
  const toolLabels = useMemo(() => getToolLabels(t), [t]);
  const visibleEvents = useMemo(
    () =>
      showAll
        ? getAllVisibleEvents(events)
        : runningOnly
          ? getRunningEvents(events)
          : getVisibleEvents(events),
    [events, runningOnly, showAll],
  );
  const displayEvents = useMemo(
    () =>
      compactDelegations
        ? compactDelegationEvents(visibleEvents)
        : visibleEvents.map((event) => ({ kind: "event" as const, event })),
    [compactDelegations, visibleEvents],
  );

  if (visibleEvents.length === 0) {
    return <SwarmRunOverview events={events} className={className} />;
  }

  if (groupByAgent) {
    return (
      <div className={className}>
        <SwarmRunOverview events={events} />
        <GroupedTimeline
          events={visibleEvents}
          allEvents={events}
          toolLabels={toolLabels}
          t={t}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 py-1.5", className)}>
      <SwarmRunOverview events={events} />
      {displayEvents.map((item) =>
        item.kind === "event" ? (
          <ParentWithChildren
            key={item.event.id}
            event={item.event}
            allEvents={events}
            toolLabels={toolLabels}
            t={t}
          />
        ) : (
          <DelegationSummaryRow
            key={`delegation-summary:${item.target}`}
            events={item.events}
            target={item.target}
            t={t}
          />
        ),
      )}
    </div>
  );
}

type TimelineDisplayItem =
  | { kind: "event"; event: LiveToolEvent }
  | { kind: "delegation"; events: LiveToolEvent[]; target: string };

function compactDelegationEvents(
  events: LiveToolEvent[],
): TimelineDisplayItem[] {
  const items: TimelineDisplayItem[] = [];
  const buckets = new Map<
    string,
    Extract<TimelineDisplayItem, { kind: "delegation" }>
  >();
  for (const event of events) {
    if (event.lifecycle || !/agent|delegate|orchestrat/i.test(event.name)) {
      items.push({ kind: "event", event });
      continue;
    }
    const input = event.input ?? {};
    const target =
      ["agent_id", "subagent_id", "subagent_name", "role", "agent", "name"]
        .map((key) => input[key])
        .find(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        )
        ?.trim() ||
      event.subAgentRole ||
      event.agentName ||
      "other";
    const existing = buckets.get(target);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    const summary = { kind: "delegation" as const, events: [event], target };
    buckets.set(target, summary);
    items.push(summary);
  }
  return items.flatMap((item) =>
    item.kind === "delegation" && item.events.length === 1
      ? [{ kind: "event" as const, event: item.events[0]! }]
      : [item],
  );
}

function DelegationSummaryRow({
  events,
  target,
  t,
}: {
  events: LiveToolEvent[];
  target: string;
  t: TimelineT;
}) {
  const running = events.some((event) => event.status === "running");
  const error = events.some((event) => event.status === "error");
  const interrupted = events.some((event) => event.status === "interrupted");
  return (
    <div className="flex items-center gap-2 py-1.5 pl-2 text-xs text-muted-foreground">
      {running ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-success" />
      ) : error ? (
        <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
      ) : interrupted ? (
        <CircleStopIcon
          aria-label={t.liveToolTimeline.statusInterrupted}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : (
        <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />
      )}
      <BrainCircuitIcon className="size-3.5 shrink-0 text-chart-6" />
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {t.liveToolTimeline.callSubAgent(target)}
      </span>
      <span className="ml-auto shrink-0 tabular-nums">{events.length}×</span>
    </div>
  );
}

function ParentWithChildren({
  event,
  allEvents,
  toolLabels,
  t,
  showAgent,
}: {
  event: LiveToolEvent;
  allEvents: LiveToolEvent[];
  toolLabels: Record<string, string>;
  t: TimelineT;
  showAgent?: boolean;
}) {
  const children = useMemo(
    () => getChildren(allEvents, event.id),
    [allEvents, event.id],
  );
  if (children.length === 0) {
    return (
      <ToolEventRow
        event={event}
        toolLabels={toolLabels}
        t={t}
        showAgent={showAgent}
      />
    );
  }
  return (
    <div className="space-y-1">
      <ToolEventRow
        event={event}
        toolLabels={toolLabels}
        t={t}
        showAgent={showAgent}
      />
      <div className="ml-6 space-y-1 border-l border-primary/20 pl-2">
        {children.map((child) => (
          <ToolEventRow
            key={`${event.id}:${child.id}`}
            event={child}
            toolLabels={toolLabels}
            t={t}
            showAgent
            nested
          />
        ))}
      </div>
    </div>
  );
}

function GroupedTimeline({
  events,
  allEvents,
  toolLabels,
  t,
  className,
}: {
  events: LiveToolEvent[];
  allEvents: LiveToolEvent[];
  toolLabels: Record<string, string>;
  t: TimelineT;
  className?: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; events: LiveToolEvent[] }>();
    for (const e of events) {
      const key = timelineAgentGroupId(e) ?? "__main__";
      if (!map.has(key)) {
        map.set(key, {
          name: e.subagentCodename ?? e.agentName ?? e.subAgentRole ?? key,
          events: [],
        });
      }
      map.get(key)!.events.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className={cn("space-y-3 py-1.5", className)}>
      {grouped.map(([agentId, group]) => (
        <div key={agentId}>
          {agentId !== "__main__" && (
            <button
              type="button"
              onClick={() => emitAgentWorkbenchFocus({ agentId })}
              className="mb-1 flex w-full items-center gap-1.5 rounded-md px-3 py-1 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
            >
              <span
                className={cn(
                  "size-1.5 rounded-lg",
                  group.events.some((event) => event.status === "error")
                    ? "bg-destructive"
                    : group.events.some((event) => event.status === "running")
                      ? "animate-pulse bg-primary"
                      : "bg-success",
                )}
              />
              {group.name}
            </button>
          )}
          <div className="space-y-1">
            {group.events.map((item) => (
              <ParentWithChildren
                key={item.id}
                event={item}
                allEvents={allEvents}
                toolLabels={toolLabels}
                t={t}
                showAgent={agentId === "__main__" && !!item.agentName}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function timelineAgentGroupId(event: LiveToolEvent): string | undefined {
  const lane =
    (event.agentId && event.agentId !== event.subAgentRole
      ? event.agentId
      : undefined) ??
    event.subagentCodename ??
    event.agentId ??
    event.agentName ??
    event.subAgentRole;
  if (event.parentToolUseId && lane) {
    return `${event.parentToolUseId}:${lane}`;
  }
  return lane;
}
