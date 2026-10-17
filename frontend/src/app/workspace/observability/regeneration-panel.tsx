// ═══════════════════════════════════════════════════════════
// PANEL 4 · REGENERATION SUMMARY
// Presentational: page.tsx polls /api/regeneration/summary and passes the
// heartbeat in.
// ═══════════════════════════════════════════════════════════

import { RefreshCwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { useI18n } from "@/core/i18n/hooks";

import type { HeartbeatState, RegenSummary } from "./observability-types";
import { StatusDot } from "./observability-ui";

export function RegenerationPanelView({
  heartbeat,
}: {
  heartbeat: HeartbeatState<RegenSummary | null>;
}) {
  const { t } = useI18n();
  const { data, loading, error, forbidden, refresh } = heartbeat;

  if (loading && !data) {
    return <LoadingState title={t.observabilityPage.loading} />;
  }
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
  if (!data) return null;

  const producers = [
    {
      key: "skill_forge",
      label: t.observabilityPage.regenProducers.skillForge,
      metric: t.observabilityPage.runReviewMetricForged(
        data.skill_forge.forged_count,
      ),
      status: data.skill_forge.status,
      hint: t.observabilityPage.regenProducers.skillForgeHint,
    },
    {
      key: "rule_extractor",
      label: t.observabilityPage.regenProducers.ruleExtractor,
      metric: t.observabilityPage.runReviewMetricRules(
        data.rule_extractor.rules_count,
      ),
      status: data.rule_extractor.status,
      hint: t.observabilityPage.regenProducers.ruleExtractorHint(
        data.rule_extractor.failure_trajectories,
      ),
    },
    {
      key: "memory_consolidator",
      label: t.observabilityPage.regenProducers.memoryConsolidator,
      metric: t.observabilityPage.runReviewMetricMems(
        data.memory_consolidator.memories_count,
      ),
      status: data.memory_consolidator.status,
      hint: t.observabilityPage.regenProducers.memoryConsolidatorHint(
        data.memory_consolidator.trajectories_scanned,
      ),
    },
    {
      key: "kg_updater",
      label: t.observabilityPage.regenProducers.kgUpdater,
      metric: t.observabilityPage.runReviewMetricTriples(
        data.kg_updater.triple_count,
      ),
      status: data.kg_updater.status,
      hint: t.observabilityPage.regenProducers.kgUpdaterHint,
    },
    {
      key: "workflow_rewriter",
      label: t.observabilityPage.regenProducers.workflowRewriter,
      metric: t.observabilityPage.runReviewMetricTraj(
        data.workflow_rewriter.trajectories_scanned,
      ),
      status: data.workflow_rewriter.status,
      hint: t.observabilityPage.regenProducers.workflowRewriterHint,
    },
    {
      key: "recipe_evaluator",
      label: t.observabilityPage.regenProducers.recipeEvaluator,
      metric: t.observabilityPage.runReviewMetricRecipes(
        data.recipe_evaluator.recipes_tracked,
      ),
      status: data.recipe_evaluator.status,
      hint: t.observabilityPage.regenProducers.recipeEvaluatorHint,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {t.observabilityPage.trajectoryTotal} · {data.trajectories.total}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t.observabilityPage.failureCount} · {data.trajectories.failures}
        </Badge>
        {Object.entries(data.trajectories.by_strategy).map(([k, n]) => (
          <Badge key={k} variant="outline" className="text-xs font-mono">
            {k}:{n}
          </Badge>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh}>
          <RefreshCwIcon className="size-3" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {producers.map((p) => (
          <Card key={p.key}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold">
                  {p.label}
                </CardTitle>
                <StatusDot status={p.status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">{p.metric}</div>
              <div className="mt-1 text-xs text-muted-foreground">{p.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
