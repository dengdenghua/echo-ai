// ═══════════════════════════════════════════════════════════
// PANEL 1 · SWARM SESSION
// Groups sub-agent tool events under their parent call_agent_parallel
// tool_use row · uses /api/progress to find running delegations and
// /api/stream (SSE) to observe live sub-agent tool_starts. Because
// this page isn't bound to a thread, we watch the GLOBAL event
// stream and surface whichever parent tool_use blocks are active.
// ═══════════════════════════════════════════════════════════

import { NetworkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { swallow } from "@/core/utils/log";
import { isRecord } from "@/core/utils/guards";
import { getBackendBaseURL } from "@/core/config";
import { openSseStream } from "@/core/streaming/sse";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";

interface SubToolRecord {
  id: string;
  name: string;
  sub_agent_role?: string;
  parent_tool_use_id?: string;
  input_preview?: Record<string, unknown>;
  status: "running" | "success" | "error";
  started_at: number;
  finished_at?: number;
}

/** The fields of a ``/api/stream`` frame this panel reads. */
interface SwarmStreamEvent {
  event_type?: string;
  task_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  role_id?: string;
  parent_tool_use_id?: string;
  is_error: boolean;
  step?: { sucker_id?: string; node_id?: string };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseSwarmStreamEvent(raw: unknown): SwarmStreamEvent | null {
  if (!isRecord(raw)) return null;
  const step = isRecord(raw.step)
    ? {
        sucker_id: optionalString(raw.step.sucker_id),
        node_id: optionalString(raw.step.node_id),
      }
    : undefined;
  return {
    event_type: optionalString(raw.event_type),
    task_id: optionalString(raw.task_id),
    tool_call_id: optionalString(raw.tool_call_id),
    tool_name: optionalString(raw.tool_name),
    role_id: optionalString(raw.role_id),
    parent_tool_use_id: optionalString(raw.parent_tool_use_id),
    is_error: Boolean(raw.is_error),
    step,
  };
}

export function SwarmPanel() {
  const { t } = useI18n();
  const [events, setEvents] = useState<SubToolRecord[]>([]);
  const [connected, setConnected] = useState(false);
  // Resume cursor: the last SSE ``id:`` seen, so a reconnect asks the
  // server to replay the gap instead of silently losing it.
  const lastEventIdRef = useRef<string | null>(null);

  // Consume the global journal SSE feed. Now that
  // ``ephemeral_runner._emit_sub_tool_event`` mirrors to the journal,
  // the parent ``sub_tool_start`` / ``sub_tool_end`` frames flow on
  // ``/api/stream`` as first-class events. We index by tool_call_id
  // so a start/end pair updates a single row in place.
  useEffect(() => {
    const base = getBackendBaseURL();
    return openSseStream({
      url: `${base}/api/stream`,
      lastEventId: () => lastEventIdRef.current,
      onOpen: () => setConnected(true),
      onReconnecting: () => setConnected(false),
      onEvent: (msg) => {
        if (msg.id != null) lastEventIdRef.current = msg.id;
        try {
          const p = parseSwarmStreamEvent(JSON.parse(msg.data));
          if (!p) return;

          // sub_tool_start / sub_tool_end · the new direct-from-journal
          // path (preferred — carries role_id, tool_name, error status).
          if (
            p.event_type === "sub_tool_start" ||
            p.event_type === "sub_tool_end"
          ) {
            const callId = p.tool_call_id;
            if (!callId) return;
            setEvents((prev) => {
              const idx = prev.findIndex((r) => r.id === callId);
              if (p.event_type === "sub_tool_start") {
                if (idx >= 0) return prev; // dedupe
                const startRec: SubToolRecord = {
                  id: callId,
                  name: p.tool_name ?? "?",
                  sub_agent_role: p.role_id,
                  parent_tool_use_id:
                    p.parent_tool_use_id ?? p.task_id ?? undefined,
                  status: "running",
                  started_at: Date.now(),
                };
                return [...prev, startRec].slice(-40);
              }
              // sub_tool_end · update existing record (or append closed)
              const endStatus: "error" | "success" = p.is_error
                ? "error"
                : "success";
              if (idx < 0) {
                const closedRec: SubToolRecord = {
                  id: callId,
                  name: p.tool_name ?? "?",
                  sub_agent_role: p.role_id,
                  parent_tool_use_id:
                    p.parent_tool_use_id ?? p.task_id ?? undefined,
                  status: endStatus,
                  started_at: Date.now(),
                  finished_at: Date.now(),
                };
                return [...prev, closedRec].slice(-40);
              }
              const existing = prev[idx];
              if (!existing) return prev;
              const updated = [...prev];
              const merged: SubToolRecord = {
                ...existing,
                status: endStatus,
                finished_at: Date.now(),
              };
              updated[idx] = merged;
              return updated;
            });
            return;
          }

          // Legacy `step` fallback for plain skill calls (kept so the
          // panel still shows non-subagent activity).
          if (p.event_type !== "step") return;
          const sid = p.step?.sucker_id;
          if (!sid) return;
          setEvents((prev) => {
            const next: SubToolRecord[] = [
              ...prev,
              {
                id: `${p.task_id ?? "?"}-${p.step?.node_id ?? "?"}-${prev.length}`,
                name: sid,
                parent_tool_use_id: p.task_id,
                status: "success",
                started_at: Date.now(),
                finished_at: Date.now(),
              },
            ];
            return next.slice(-40);
          });
        } catch (e) {
          swallow(e);
        }
      },
    });
  }, []);

  // Group by parent_tool_use_id (== task_id here) so each active
  // task renders as a row with its sub-events nested underneath.
  const grouped = useMemo(() => {
    const map = new Map<string, SubToolRecord[]>();
    for (const e of events) {
      const k = e.parent_tool_use_id ?? "(unbound)";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).slice(-8);
  }, [events]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            {t.observabilityPage.swarmCardTitle}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "size-2 rounded-full",
                connected ? "bg-success animate-pulse" : "bg-muted",
              )}
            />
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              {connected
                ? t.observabilityPage.connected
                : t.observabilityPage.idle}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {grouped.length === 0 && (
          <Empty className="border-0 bg-transparent shadow-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <NetworkIcon />
              </EmptyMedia>
              <EmptyTitle>{t.observabilityPage.noConcurrentTasks}</EmptyTitle>
              <EmptyDescription>
                {t.observabilityPage.noConcurrentTasksHint}
                <br />
                <span className="text-xs">
                  {t.observabilityPage.nestedSseNote}
                </span>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {grouped.map(([taskId, sub]) => (
          <div
            key={taskId}
            className="rounded-lg border border-border-default bg-muted/20 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-mono text-muted-foreground">
                {t.observabilityPage.taskPrefix}:{taskId.slice(0, 16)}
              </div>
              <Badge variant="outline" className="text-xs">
                {t.observabilityPage.stepsCount(sub.length)}
              </Badge>
            </div>
            <div className="space-y-1">
              {sub.slice(-6).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1 text-xs"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      s.status === "running"
                        ? "bg-warning animate-pulse"
                        : s.status === "error"
                          ? "bg-destructive"
                          : "bg-success",
                    )}
                  />
                  {s.sub_agent_role && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {s.sub_agent_role}
                    </Badge>
                  )}
                  <span className="font-mono">{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
