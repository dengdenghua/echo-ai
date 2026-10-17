import { FlaskConicalIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";

import type { BenchmarkRow, CurriculumGoal, EvolutionApi } from "./types";
import { Card, EmptyState, Pill, fixed, numberOrZero } from "./ui";

// ---------------------------------------------------------------------------
// Section: Curriculum goals
// ---------------------------------------------------------------------------

export function CurriculumSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<CurriculumGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<CurriculumGoal[]>(
        "/api/evolution/curriculum/goals?status=pending",
      );
      setRows(data);
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

  const runCycle = useCallback(async () => {
    try {
      await api.post("/api/evolution/curriculum/cycle/run", {});
      await load();
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, load]);

  const decide = useCallback(
    async (id: number, status: string, covered_by?: string) => {
      try {
        await api.post("/api/evolution/curriculum/goals/decide", {
          goal_id: id,
          status,
          covered_by,
        });
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
      title={t.evolutionControl.curriculum.cardTitle}
      icon={<SparklesIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
      headerRight={
        <button
          type="button"
          onClick={runCycle}
          className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted"
        >
          {t.evolutionControl.curriculum.runCycle}
        </button>
      }
    >
      {!rows.length && !loading && (
        <EmptyState text={t.evolutionControl.curriculum.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map((g) => (
          <div key={g.id} className="flex flex-col gap-1 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{g.title}</span>
              <div className="flex items-center gap-2">
                <Pill label={g.category} tone="info" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  p={fixed(g.priority, 1)} · n={numberOrZero(g.failure_count)}
                </span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {g.description}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => decide(g.id, "in_progress")}
                className="rounded-lg border border-border-default px-2 py-0.5 text-xs hover:bg-muted"
              >
                {t.evolutionControl.curriculum.start}
              </button>
              <button
                type="button"
                onClick={() => decide(g.id, "dismissed")}
                className="rounded-lg border border-border-default px-2 py-0.5 text-xs hover:bg-muted"
              >
                {t.evolutionControl.curriculum.dismiss}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Framework benchmarks
// ---------------------------------------------------------------------------

export function FrameworkBenchmarksSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<BenchmarkRow[]>(
        "/api/intel-evolution/frameworks/benchmarks",
      );
      setRows(data);
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

  return (
    <Card
      title={t.evolutionControl.frameworks.cardTitle}
      icon={<FlaskConicalIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
    >
      {!rows.length && !loading && (
        <EmptyState text={t.evolutionControl.frameworks.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map((b) => (
          <div
            key={b.id}
            className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div>
              <div className="font-mono text-xs">
                #{b.id} {b.strategy_a} vs {b.strategy_b}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.evolutionControl.frameworks.baseModelPrefix}
                {b.base_model}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
              <span>A: {b.a_wins}</span>
              <span>B: {b.b_wins}</span>
              <span>
                {t.evolutionControl.frameworks.tiesPrefix}
                {b.ties}
              </span>
              <span>
                {t.evolutionControl.frameworks.bWinRatePrefix}
                {fixed(numberOrZero(b.win_rate_b) * 100, 0)}%
              </span>
              <Pill
                label={b.decision}
                tone={
                  b.decision === "prefer_b"
                    ? "ok"
                    : b.decision === "prefer_a"
                      ? "info"
                      : b.decision === "rejected_budget"
                        ? "bad"
                        : "muted"
                }
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
