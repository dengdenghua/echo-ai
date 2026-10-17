import { AlertTriangleIcon, ShieldAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";

import type { DriftEvent, EvolutionApi, RepairProposal } from "./types";
import { Card, EmptyState } from "./ui";

// ---------------------------------------------------------------------------
// Section: Protocol drift + repair
// ---------------------------------------------------------------------------

export function ProtocolDriftSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [events, setEvents] = useState<DriftEvent[]>([]);
  const [repairs, setRepairs] = useState<RepairProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ev, rp] = await Promise.all([
        api.get<DriftEvent[]>(
          "/api/intel-evolution/protocols/drift?acknowledged=false",
        ),
        api.get<RepairProposal[]>(
          "/api/intel-evolution/protocols/repair/proposals?status=pending",
        ),
      ]);
      setEvents(ev);
      setRepairs(rp);
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = useCallback(async () => {
    setBusy(true);
    try {
      await api.post("/api/intel-evolution/protocols/drift/scan", {});
      await load();
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  const sweep = useCallback(async () => {
    setBusy(true);
    try {
      await api.post("/api/intel-evolution/protocols/repair/sweep", {});
      await load();
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [api, load]);

  const acknowledge = useCallback(
    async (id: number) => {
      try {
        await api.post(
          `/api/intel-evolution/protocols/drift/${id}/acknowledge`,
          {},
        );
        await load();
      } catch (e) {
        swallow(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api, load],
  );

  return (
    <Card
      title={t.evolutionControl.drift.cardTitle}
      icon={<ShieldAlertIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
      headerRight={
        <div className="flex gap-1">
          <button
            type="button"
            onClick={scan}
            disabled={busy}
            className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {t.evolutionControl.drift.scanButton}
          </button>
          <button
            type="button"
            onClick={sweep}
            disabled={busy}
            className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {t.evolutionControl.drift.sweepButton}
          </button>
        </div>
      }
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t.evolutionControl.drift.eventsHeader}
      </div>
      {!events.length && !loading && (
        <EmptyState text={t.evolutionControl.drift.emptyEvents} />
      )}
      <div className="divide-y divide-border/60">
        {events.map((ev) => (
          <div
            key={ev.id}
            className="flex items-start justify-between gap-2 py-2"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <AlertTriangleIcon className="size-3.5 text-warning" />
                <span className="font-mono text-xs">{ev.protocol_id}</span>
                <span className="text-xs text-muted-foreground">
                  {ev.detected_at}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {ev.summary}
              </div>
            </div>
            <button
              type="button"
              onClick={() => acknowledge(ev.id)}
              className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted"
            >
              {t.evolutionControl.drift.acknowledgeButton}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t.evolutionControl.drift.repairsHeader}
      </div>
      {!repairs.length && !loading && (
        <EmptyState text={t.evolutionControl.drift.emptyRepairs} />
      )}
      <div className="divide-y divide-border/60">
        {repairs.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 py-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{r.protocol_id}</span>
              <span className="text-xs text-muted-foreground">
                {t.evolutionControl.drift.eventPrefix(r.drift_event_id)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{r.rationale}</div>
            {r.repair_tasks?.length ? (
              <div className="mt-1 rounded-md border border-border-default bg-muted/40 px-2 py-1.5">
                {r.repair_tasks.slice(0, 2).map((task) => (
                  <div key={task.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        {task.title}
                      </span>
                      <span className="rounded border border-border-default px-1.5 py-0.5 font-mono text-muted-foreground">
                        {task.priority}
                      </span>
                      <span className="text-muted-foreground">
                        {task.target_layer}
                      </span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {task.target_modules.slice(0, 3).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-primary">
                {t.evolutionControl.drift.diffSummary}
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-muted p-2 text-xs">
                {r.suggested_diff}
              </pre>
            </details>
          </div>
        ))}
      </div>
    </Card>
  );
}
