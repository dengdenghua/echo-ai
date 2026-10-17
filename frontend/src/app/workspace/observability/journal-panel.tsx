// ═══════════════════════════════════════════════════════════
// PANEL 3 · JOURNAL STREAM
// ═══════════════════════════════════════════════════════════

import { ActivityIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { swallow } from "@/core/utils/log";
import { isRecord } from "@/core/utils/guards";
import { getBackendBaseURL } from "@/core/config";
import { openSseStream } from "@/core/streaming/sse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";

import { eventRowColor, shortTs } from "./observability-format";

interface JournalEvent {
  event_type: string;
  ts: string;
  task_id?: string;
  arm_id?: string;
  path?: string;
  action?: string;
  // SubTool fields
  role_id?: string;
  tool_call_id?: string;
  tool_name?: string;
  iteration?: number;
  args_preview?: string;
  output_preview?: string;
  is_error?: boolean;
  duration_ms?: number;
  parent_tool_use_id?: string | null;
  // BrowserArtifact fields
  kind?: string;
  url?: string;
  filename?: string;
  caption?: string;
  mime_type?: string;
  width?: number | null;
  height?: number | null;
  thread_id?: string;
  [key: string]: unknown;
}

/** A journal frame: an object carrying its ``event_type``. */
function isJournalEvent(value: unknown): value is JournalEvent {
  return isRecord(value) && typeof value.event_type === "string";
}

export function JournalPanel() {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Resume cursor: the last SSE ``id:`` seen, so a reconnect asks the
  // server to replay the gap instead of silently losing it.
  const lastEventIdRef = useRef<string | null>(null);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const handleClear = useCallback(async () => {
    if (events.length === 0) return;
    if (
      !(await confirm({
        title: t.observabilityPage.clearConfirmTitle,
        description: t.observabilityPage.clearConfirmDescription,
        confirmLabel: t.observabilityPage.clear,
      }))
    )
      return;
    setEvents([]);
  }, [
    confirm,
    events.length,
    t.observabilityPage.clearConfirmTitle,
    t.observabilityPage.clearConfirmDescription,
    t.observabilityPage.clear,
  ]);

  useEffect(() => {
    const base = getBackendBaseURL();
    return openSseStream({
      url: `${base}/api/stream`,
      lastEventId: () => lastEventIdRef.current,
      onOpen: () => setConnected(true),
      onReconnecting: () => setConnected(false),
      onEvent: (msg) => {
        if (pausedRef.current) return;
        if (msg.id != null) lastEventIdRef.current = msg.id;
        try {
          const p: unknown = JSON.parse(msg.data);
          if (!isJournalEvent(p)) return;
          setEvents((prev) => {
            const next = [...prev, p];
            return next.slice(-200);
          });
        } catch (e) {
          swallow(e);
        }
      },
    });
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events) c[e.event_type] = (c[e.event_type] ?? 0) + 1;
    return c;
  }, [events]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            {t.observabilityPage.journalEventStream}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "size-2 rounded-full",
                connected ? "bg-success animate-pulse" : "bg-muted",
              )}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={paused}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? t.observabilityPage.resume : t.observabilityPage.pause}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={events.length === 0}
            >
              {t.observabilityPage.clear}
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([kind, n]) => (
            <Badge key={kind} variant="outline" className="text-xs font-mono">
              {kind} · {n}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 && (
          <Empty className="border-0 bg-transparent shadow-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon />
              </EmptyMedia>
              <EmptyTitle>{t.observabilityPage.noEvents}</EmptyTitle>
              <EmptyDescription>
                {t.observabilityPage.noEventsHint}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="max-h-[60vh] overflow-auto font-mono text-xs">
          {events
            .slice()
            .reverse()
            .map((e, i) => (
              <div
                key={i}
                className={cn(
                  "border-b border-border-subtle px-2 py-1.5",
                  eventRowColor(e.event_type),
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    {shortTs(e.ts)}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {e.event_type}
                  </Badge>
                  {e.task_id && (
                    <span className="text-xs text-muted-foreground truncate">
                      {t.observabilityPage.taskPrefix}:{e.task_id.slice(0, 12)}
                    </span>
                  )}
                  {e.path && (
                    <span className="text-xs text-primary truncate">
                      {e.action ?? t.observabilityPage.eventActionFile}:{" "}
                      {e.path}
                    </span>
                  )}
                  {/* SubTool events — role + tool + status */}
                  {(e.event_type === "sub_tool_start" ||
                    e.event_type === "sub_tool_end") && (
                    <span className="text-xs truncate flex items-center gap-1.5">
                      {e.role_id && (
                        <Badge variant="outline" className="text-xs font-mono">
                          {e.role_id}
                        </Badge>
                      )}
                      <span className="text-primary font-mono">
                        {e.tool_name ?? "?"}
                      </span>
                      {e.event_type === "sub_tool_end" && (
                        <span
                          className={cn(
                            "text-xs",
                            e.is_error ? "text-destructive" : "text-success",
                          )}
                        >
                          {e.is_error
                            ? t.observabilityPage.eventFailure
                            : t.observabilityPage.eventSuccess}
                          {e.duration_ms !== undefined &&
                            t.observabilityPage.eventDurationSuffix(
                              e.duration_ms,
                            )}
                        </span>
                      )}
                    </span>
                  )}
                  {/* BrowserArtifact — inline thumbnail + caption */}
                  {e.event_type === "browser_artifact" && e.url && (
                    <span className="text-xs truncate flex items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">
                        {e.kind ?? t.observabilityPage.eventArtifactScreenshot}
                      </Badge>
                      <a
                        href={`${getBackendBaseURL()}${e.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-2 hover:underline truncate max-w-[12rem] sm:max-w-[18rem]"
                        title={e.caption || e.filename}
                      >
                        {e.filename ?? t.observabilityPage.eventArtifact}
                      </a>
                      {e.width && e.height && (
                        <span className="text-muted-foreground">
                          {e.width}×{e.height}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {/* Inline thumbnail for screenshots */}
                {e.event_type === "browser_artifact" &&
                  e.url &&
                  e.mime_type?.startsWith("image/") && (
                    <div className="mt-1.5 pl-4">
                      <a
                        href={`${getBackendBaseURL()}${e.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={`${getBackendBaseURL()}${e.url}`}
                          alt={
                            e.caption ||
                            e.filename ||
                            t.observabilityPage.eventArtifactScreenshot
                          }
                          className="max-h-32 max-w-[12rem] sm:max-w-[20rem] rounded-md border border-border-subtle object-contain"
                          loading="lazy"
                        />
                      </a>
                      {e.caption && (
                        <div className="mt-1 text-xs text-muted-foreground italic truncate max-w-[12rem] sm:max-w-[20rem]">
                          {e.caption}
                        </div>
                      )}
                    </div>
                  )}
                {/* Args / output preview for SubTool events */}
                {e.event_type === "sub_tool_start" && e.args_preview && (
                  <div className="mt-1 pl-4 text-xs text-muted-foreground truncate">
                    → {e.args_preview}
                  </div>
                )}
                {e.event_type === "sub_tool_end" && e.output_preview && (
                  <div className="mt-1 pl-4 text-xs text-muted-foreground truncate">
                    ← {e.output_preview}
                  </div>
                )}
              </div>
            ))}
        </div>
      </CardContent>
      {confirmDialog}
    </Card>
  );
}
