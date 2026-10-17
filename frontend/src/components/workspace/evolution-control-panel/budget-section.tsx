import { GaugeIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";

import type { BudgetSnapshot, EvolutionApi } from "./types";
import { Bar, Card, EmptyState, LoadingRow, Pill } from "./ui";

// ---------------------------------------------------------------------------
// Section: Budget + breakers
// ---------------------------------------------------------------------------

export function BudgetSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<BudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<BudgetSnapshot>(
        "/api/evolution/budget/snapshot",
      );
      setSnap(data);
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

  const resetBreaker = useCallback(
    async (component: string) => {
      try {
        await api.post("/api/evolution/budget/breaker/reset", { component });
        void load();
      } catch (e) {
        swallow(e);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api, load],
  );

  return (
    <Card
      title={t.evolutionControl.budget.cardTitle}
      icon={<GaugeIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
      headerRight={
        snap ? (
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {t.evolutionControl.budget.source(
              snap.source ?? "unknown",
              snap.events ?? 0,
            )}
          </span>
        ) : null
      }
    >
      {!snap && loading && <LoadingRow />}
      {snap && snap.components.length === 0 && (
        <EmptyState text={t.evolutionControl.budget.empty} />
      )}
      <div className="flex flex-col divide-y divide-border/60">
        {snap?.components.map((c) => {
          const hourly = c.usage.hourly_used;
          const hourlyLimit = c.usage.hourly_limit;
          const hourlyPct = hourlyLimit
            ? Math.round((hourly / hourlyLimit) * 100)
            : 0;
          const tone: "ok" | "warn" | "bad" =
            hourlyPct >= 90 ? "bad" : hourlyPct >= 60 ? "warn" : "ok";
          const breakerTone: "ok" | "warn" | "bad" =
            c.breaker.state === "open"
              ? "bad"
              : c.breaker.state === "half_open"
                ? "warn"
                : "ok";
          const breakerStateLabel =
            c.breaker.state === "closed"
              ? t.evolutionControl.budget.breakerStates.closed
              : c.breaker.state === "open"
                ? t.evolutionControl.budget.breakerStates.open
                : t.evolutionControl.budget.breakerStates.halfOpen;
          const dailyUsd = c.cost?.daily_usd ?? 0;
          const dailyTokens = c.cost?.daily_tokens ?? 0;
          return (
            <div
              key={c.name}
              className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-[160px] flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{c.name}</span>
                  <Pill
                    label={breakerStateLabel}
                    tone={
                      breakerTone === "bad"
                        ? "bad"
                        : breakerTone === "warn"
                          ? "warn"
                          : "ok"
                    }
                  />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.evolutionControl.budget.consecutiveFailures(
                    c.breaker.consecutive_failures,
                    c.budget.max_calls_per_hour,
                  )}
                </div>
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.evolutionControl.budget.perHour}</span>
                  <span className="tabular-nums">
                    {hourly}/{hourlyLimit}
                  </span>
                </div>
                <Bar
                  pct={hourlyPct}
                  tone={tone}
                  label={t.evolutionControl.budget.hourlyUsageAria(
                    c.name,
                    hourly,
                    hourlyLimit,
                  )}
                />
              </div>
              <div className="flex min-w-[180px] flex-col gap-0.5 text-xs text-muted-foreground">
                <span>
                  {t.evolutionControl.budget.last24h(
                    c.last_24h.success,
                    c.last_24h.failure,
                  )}
                </span>
                <span>
                  {t.evolutionControl.budget.rejected(
                    c.last_24h.rejected_budget,
                    c.last_24h.rejected_breaker,
                  )}
                </span>
                <span>
                  {t.evolutionControl.budget.dailyUsage(
                    c.usage.daily_used,
                    c.usage.daily_limit,
                  )}
                </span>
                <span>
                  {t.evolutionControl.budget.cost(dailyTokens, dailyUsd)}
                </span>
                {c.last_reset_at && (
                  <span>
                    {t.evolutionControl.budget.lastReset(c.last_reset_at)}
                  </span>
                )}
              </div>
              {c.breaker.state !== "closed" && (
                <button
                  type="button"
                  onClick={() => resetBreaker(c.name)}
                  className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted"
                >
                  {t.evolutionControl.budget.resetButton}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
