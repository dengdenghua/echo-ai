// ═══════════════════════════════════════════════════════════
// PANEL 5 · HEMOLYMPH 4-BUCKET METER
// Presentational: page.tsx polls /api/hemolymph/recent and passes the
// heartbeat in.
// ═══════════════════════════════════════════════════════════

import { GaugeIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ErrorState } from "@/components/ui/state";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";

import type { HeartbeatState, HemolymphResp } from "./observability-types";

export function HemolymphPanelView({
  heartbeat,
}: {
  heartbeat: HeartbeatState<HemolymphResp>;
}) {
  const { t } = useI18n();
  const { data, error, forbidden } = heartbeat;

  if (error) {
    return (
      <ErrorState
        title={
          forbidden
            ? t.observabilityPage.crossTenantAdminRequired
            : t.observabilityPage.errorPrefix
        }
        detail={forbidden ? undefined : error}
      />
    );
  }

  const latest = data.snapshots[data.snapshots.length - 1];
  const buckets = ["system", "suckers", "memory", "history"] as const;
  const bucketColors: Record<string, string> = {
    system: "bg-chart-6",
    suckers: "bg-chart-8",
    memory: "bg-chart-4",
    history: "bg-chart-1",
  };
  const bucketLabels: Record<string, string> = {
    system: t.observabilityPage.hemolymphBuckets.system,
    suckers: t.observabilityPage.hemolymphBuckets.suckers,
    memory: t.observabilityPage.hemolymphBuckets.memory,
    history: t.observabilityPage.hemolymphBuckets.history,
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t.observabilityPage.latestCompose}
            {latest && (
              <span className="ml-2 text-xs text-muted-foreground">
                · {t.observabilityPage.utilizationLabel}{" "}
                {(latest.utilization * 100).toFixed(1)}%
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!latest && (
            <Empty className="border-0 bg-transparent shadow-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GaugeIcon />
                </EmptyMedia>
                <EmptyTitle>{t.observabilityPage.noComposeRecords}</EmptyTitle>
                <EmptyDescription>
                  {t.observabilityPage.noComposeRecordsHint}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {latest && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {t.observabilityPage.total}
                </span>
                <span className="font-mono">
                  {latest.tokens_used} / {latest.budget_tokens}{" "}
                  {t.observabilityPage.snapshotTokensUnit}
                </span>
              </div>
              <Progress value={latest.utilization * 100} />
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {buckets.map((b) => {
                  const info = latest.by_bucket[b] ?? { used: 0, alloc: 1 };
                  const pct =
                    info.alloc > 0 ? (info.used / info.alloc) * 100 : 0;
                  return (
                    <div key={b} className="rounded-md bg-muted/30 p-2">
                      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            bucketColors[b],
                          )}
                        />
                        {bucketLabels[b]}
                      </div>
                      <div className="mt-1 text-sm font-mono">
                        {info.used}
                        <span className="text-muted-foreground">
                          /{info.alloc}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-background">
                        <div
                          className={cn(
                            "h-full transition-all",
                            bucketColors[b],
                          )}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t.observabilityPage.historyPrefix} {data.snapshots.length}{" "}
            {t.observabilityPage.tabJournal}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1">
                    {t.observabilityPage.hemolymphTable.ts}
                  </th>
                  <th className="py-1">
                    {t.observabilityPage.hemolymphTable.usedBudget}
                  </th>
                  <th className="py-1">
                    {t.observabilityPage.hemolymphTable.util}
                  </th>
                  <th className="py-1">
                    {t.observabilityPage.hemolymphTable.recipe}
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.snapshots
                  .slice()
                  .reverse()
                  .map((s, i) => (
                    <tr key={i} className="border-b border-border-subtle">
                      <td className="py-1 text-muted-foreground">
                        {new Date(s.ts * 1000).toLocaleTimeString()}
                      </td>
                      <td className="py-1">
                        {s.tokens_used} / {s.budget_tokens}
                      </td>
                      <td className="py-1">
                        {(s.utilization * 100).toFixed(1)}%
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {s.recipe_id ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
