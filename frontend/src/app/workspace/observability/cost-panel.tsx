// ═══════════════════════════════════════════════════════════
// PANEL 6 · COST SUMMARY
// Presentational: page.tsx polls /api/budget/summary and passes the
// heartbeat in.
// ═══════════════════════════════════════════════════════════

import { CoinsIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useI18n } from "@/core/i18n/hooks";

import { shortTs } from "./observability-format";
import type { CostSummary, HeartbeatState } from "./observability-types";
import { StatTile } from "./observability-ui";

export function CostPanelView({
  heartbeat,
}: {
  heartbeat: HeartbeatState<CostSummary>;
}) {
  const { t } = useI18n();
  const { data, refresh } = heartbeat;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <StatTile
          testId="cost-total-tokens"
          label={t.observabilityPage.cumulativeTokens}
          value={data.total_tokens.toLocaleString()}
        />
        <StatTile
          label={t.observabilityPage.cumulativeUsd}
          value={`$${data.total_usd.toFixed(4)}`}
        />
        <StatTile
          testId="cost-commit-count"
          label={t.observabilityPage.commitCount}
          value={data.commit_count.toLocaleString()}
        />
        <StatTile
          label={t.observabilityPage.taskCount}
          value={data.task_count.toLocaleString()}
        />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {t.observabilityPage.taskGroupingPrefix} {data.tasks.length}
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={refresh}>
              <RefreshCwIcon className="size-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.tasks.length === 0 && (
            <Empty className="border-0 bg-transparent shadow-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CoinsIcon />
                </EmptyMedia>
                <EmptyTitle>{t.observabilityPage.noBudgetCommits}</EmptyTitle>
                <EmptyDescription>
                  {t.observabilityPage.noBudgetCommitsHint}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {data.tasks.length > 0 && (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1">
                      {t.observabilityPage.costTable.task}
                    </th>
                    <th className="py-1">
                      {t.observabilityPage.costTable.tokens}
                    </th>
                    <th className="py-1">
                      {t.observabilityPage.costTable.usd}
                    </th>
                    <th className="py-1">
                      {t.observabilityPage.costTable.commits}
                    </th>
                    <th className="py-1">
                      {t.observabilityPage.costTable.last}
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {data.tasks.map((tk) => (
                    <tr
                      key={tk.task_id}
                      className="border-b border-border-subtle"
                    >
                      <td
                        className="py-1 max-w-[12rem] truncate"
                        title={tk.task_id}
                      >
                        {tk.task_id.slice(0, 18)}
                      </td>
                      <td className="py-1">{tk.tokens.toLocaleString()}</td>
                      <td className="py-1">${tk.usd.toFixed(5)}</td>
                      <td className="py-1">{tk.commit_count}</td>
                      <td className="py-1 text-muted-foreground">
                        {tk.last_ts ? shortTs(tk.last_ts) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
