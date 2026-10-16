import { swallow } from "@/core/utils/log";
import { CheckCircleIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Translations } from "@/core/i18n/locales/types";

import { reflexFetch } from "./api";
import type { CanaryEntry, ProposalDetailResp, StoredRun } from "./gepa-types";

export function PastRunRow({
  run,
  canary,
  onApplyGlobal,
  onApplyRecipe,
  t,
}: {
  run: StoredRun;
  canary?: CanaryEntry | null;
  onApplyGlobal: () => void;
  onApplyRecipe: (() => void) | null;
  t: Translations;
}) {
  const triggerColor =
    run.trigger === "auto_propose"
      ? "bg-chart-1/15 text-chart-1"
      : "bg-info/15 text-info";
  const dt = new Date(run.ts * 1000);
  const canApply = !!(run.best_candidate_id && run.best_prompt && !run.applied);
  const lifecyclePhase =
    run.winner_canary_phase ??
    canary?.phase ??
    run.winner_lifecycle_state ??
    run.winner_proposal_status ??
    null;
  const lifecycleColor =
    lifecyclePhase === "rolled_back"
      ? "bg-destructive/15 text-destructive"
      : lifecyclePhase === "full" || lifecyclePhase === "applied"
        ? "bg-success/15 text-success"
        : lifecyclePhase
          ? "bg-warning/15 text-warning"
          : "";
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ProposalDetailResp | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const replayCandidate =
    run.native_replay?.candidates?.find(
      (candidate) => candidate.candidate_id === run.best_candidate_id,
    ) ?? run.native_replay?.candidates?.[0];
  const nativeEvaluation =
    run.native_evaluation?.find(
      (candidate) => candidate.candidate_id === run.best_candidate_id,
    ) ?? run.native_evaluation?.[0];
  const sandboxReplayCandidate =
    run.native_sandbox_replay?.candidates?.find(
      (candidate) => candidate.candidate_id === run.best_candidate_id,
    ) ?? run.native_sandbox_replay?.candidates?.[0];
  const turnReplayCandidate =
    run.native_turn_replay?.candidates?.find(
      (candidate) => candidate.candidate_id === run.best_candidate_id,
    ) ?? run.native_turn_replay?.candidates?.[0];
  const llmReplayCandidate =
    run.native_llm_replay?.candidates?.find(
      (candidate) => candidate.candidate_id === run.best_candidate_id,
    ) ?? run.native_llm_replay?.candidates?.[0];
  const loadDetail = useCallback(async () => {
    if (!run.winner_proposal_id) return;
    if (detail || detailLoading) return;
    setDetailLoading(true);
    try {
      const r: ProposalDetailResp = await reflexFetch<ProposalDetailResp>(
        `/api/evolution/ledger/${encodeURIComponent(run.winner_proposal_id)}`,
      );
      setDetail(r);
      setDetailOpen(true);
    } catch (e) {
      swallow(e);
    } finally {
      setDetailLoading(false);
    }
  }, [detail, detailLoading, run.winner_proposal_id]);
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        lifecyclePhase === "rolled_back"
          ? "border-destructive/30 bg-destructive/5"
          : run.applied
            ? "border-success/30 bg-success/5"
            : "border-border-default",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("text-xs", triggerColor, "hover:" + triggerColor)}>
          {run.trigger === "auto_propose"
            ? t.recipeForge.triggerAutoPropose
            : t.recipeForge.triggerManual}
        </Badge>
        {run.recipe_id && (
          <span className="font-mono text-xs text-muted-foreground">
            {t.recipeForge.recipePrefix}: {run.recipe_id.slice(0, 12)}
          </span>
        )}
        <Badge className="bg-muted-foreground/15 text-xs text-muted-foreground hover:bg-muted-foreground/15">
          {run.optimizer_backend || "native_gepa"}
        </Badge>
        {lifecyclePhase && (
          <Badge
            className={cn("text-xs", lifecycleColor, "hover:" + lifecycleColor)}
          >
            {t.recipeForge.canaryPhase(lifecyclePhase)}
          </Badge>
        )}
        <span className="text-muted-foreground">{dt.toLocaleString()}</span>
        <span className="text-muted-foreground">
          · {t.recipeForge.iterCount(run.iterations_run)} ·{" "}
          {t.recipeForge.elapsedSeconds(run.elapsed_s)}
        </span>
        <span className="text-muted-foreground">· front {run.front_size}</span>
        {run.best_avg_score !== null && (
          <span className="font-mono text-success">
            {t.recipeForge.bestAvg(run.best_avg_score)}
          </span>
        )}
        <div className="flex-1" />
        {run.applied && (
          <Badge className="bg-success/15 text-xs text-success hover:bg-success/15">
            <CheckCircleIcon className="mr-1 size-3" />
            {t.recipeForge.addendumLive}
          </Badge>
        )}
        {run.winner_proposal_id && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setDetailOpen((v) => !v);
              void loadDetail();
            }}
            title={t.recipeForge.proposalDetailsButton}
          >
            {t.recipeForge.canaryProposal(run.winner_proposal_id)}
          </Button>
        )}
        {canApply && (
          <div className="flex items-center gap-1">
            {onApplyRecipe && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={onApplyRecipe}
                title={`${t.recipeForge.recipePrefix} ${run.recipe_id}`}
              >
                {t.recipeForge.applyRecipeButton(run.recipe_id!.slice(0, 12))}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={onApplyGlobal}
              title={t.recipeForge.applyGlobalButton}
            >
              {t.recipeForge.applyGlobalButton}
            </Button>
          </div>
        )}
      </div>
      {run.winner_rollback_reason && (
        <div className="mt-1 text-xs text-destructive">
          {t.recipeForge.canaryRollbackReason(run.winner_rollback_reason)}
        </div>
      )}
      {(nativeEvaluation ||
        replayCandidate ||
        sandboxReplayCandidate ||
        turnReplayCandidate ||
        llmReplayCandidate) && (
        <div className="mt-2 rounded-md border border-border-subtle bg-background/40 px-2 py-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            aria-expanded={evidenceOpen}
            onClick={() => setEvidenceOpen((value) => !value)}
          >
            <ShieldCheckIcon className="size-3 text-success" />
            <span className="font-medium text-foreground">
              {t.recipeForge.nativeEvidenceTitle}
            </span>
            {nativeEvaluation?.verdict && (
              <Badge className="bg-success/10 text-xs text-success hover:bg-success/10">
                {nativeEvaluation.verdict}
              </Badge>
            )}
            {typeof replayCandidate?.total === "number" && (
              <span>
                {t.recipeForge.nativeEvidenceReplay(replayCandidate.total)}
              </span>
            )}
            {typeof sandboxReplayCandidate?.total === "number" && (
              <span>
                {t.recipeForge.nativeEvidenceSandboxReplay(
                  sandboxReplayCandidate.total,
                  sandboxReplayCandidate.passed,
                )}
              </span>
            )}
            {typeof turnReplayCandidate?.total === "number" && (
              <span>
                {t.recipeForge.nativeEvidenceTurnReplay(
                  turnReplayCandidate.total,
                  turnReplayCandidate.passed,
                )}
              </span>
            )}
            {typeof llmReplayCandidate?.total === "number" && (
              <span>
                {t.recipeForge.nativeEvidenceLLMReplay(
                  llmReplayCandidate.total,
                  llmReplayCandidate.passed,
                )}
              </span>
            )}
            <span>
              {t.recipeForge.nativeEvidenceCases(
                Math.max(
                  run.native_replay?.case_count ?? 0,
                  run.native_sandbox_replay?.case_count ?? 0,
                  run.native_turn_replay?.case_count ?? 0,
                  run.native_llm_replay?.case_count ?? 0,
                ),
              )}
            </span>
          </button>
          {evidenceOpen && (
            <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
              {nativeEvaluation && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    {t.recipeForge.nativeEvidenceMetric(
                      "task",
                      nativeEvaluation.task_score,
                    )}
                  </span>
                  <span>
                    {t.recipeForge.nativeEvidenceMetric(
                      "constraints",
                      nativeEvaluation.constraint_score,
                    )}
                  </span>
                  <span>
                    {t.recipeForge.nativeEvidenceMetric(
                      "failures",
                      nativeEvaluation.failure_coverage,
                    )}
                  </span>
                  <span>
                    {t.recipeForge.nativeEvidenceMetric(
                      "preservation",
                      nativeEvaluation.positive_preservation,
                    )}
                  </span>
                  <span>
                    {t.recipeForge.nativeEvidenceMetric(
                      "efficiency",
                      nativeEvaluation.efficiency,
                    )}
                  </span>
                </div>
              )}
              {(llmReplayCandidate?.weak_cases?.length ?? 0) > 0 ||
              (turnReplayCandidate?.weak_cases?.length ?? 0) > 0 ||
              (sandboxReplayCandidate?.weak_cases?.length ?? 0) > 0 ||
              (replayCandidate?.weak_cases?.length ?? 0) > 0 ? (
                (
                  llmReplayCandidate?.weak_cases ??
                  turnReplayCandidate?.weak_cases ??
                  sandboxReplayCandidate?.weak_cases ??
                  replayCandidate?.weak_cases
                )?.map((weakCase) => (
                  <div
                    key={weakCase.case_id ?? weakCase.reason}
                    className="text-warning"
                  >
                    {t.recipeForge.nativeEvidenceWeakCase(
                      weakCase.case_id ?? "case",
                      weakCase.reason ?? "weak coverage",
                    )}
                    {(weakCase.missing_signals?.length ?? 0) > 0 && (
                      <span>
                        {" · "}
                        {t.recipeForge.nativeEvidenceMissing(
                          weakCase.missing_signals?.join(", ") ?? "",
                        )}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-success">
                  {t.recipeForge.nativeEvidenceNoWeakCases}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {detailOpen && (
        <div className="mt-2 rounded-md border border-border-subtle bg-background/50 p-2 text-xs text-muted-foreground">
          {!detail ? (
            <div>{t.recipeForge.proposalDetailsLoading}</div>
          ) : detail.ok && detail.proposal ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <span className="font-mono text-foreground">
                  {detail.proposal.id}
                </span>
                <span>{detail.proposal.kind}</span>
                <span>
                  {t.recipeForge.proposalDetailsStatus(detail.proposal.status)}
                </span>
                <span>
                  {t.recipeForge.proposalDetailsCanaries(
                    detail.canaries?.length ?? 0,
                  )}
                </span>
                <span>
                  {t.recipeForge.proposalDetailsRollbacks(
                    detail.rollbacks?.length ?? 0,
                  )}
                </span>
              </div>
              <div>{detail.proposal.description}</div>
              {detail.proposal.rejection_reason && (
                <div className="text-destructive">
                  {detail.proposal.rejection_reason}
                </div>
              )}
              {detail.proposal.metadata &&
                Object.keys(detail.proposal.metadata).length > 0 && (
                  <details>
                    <summary className="cursor-pointer">
                      {t.recipeForge.proposalDetailsMetadata}
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs">
                      {JSON.stringify(detail.proposal.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              {(detail.canaries?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  {detail.canaries?.map((c) => (
                    <div key={c.skill_name} className="font-mono">
                      {c.skill_name} · {c.phase} · {c.current_rate.toFixed(3)}
                    </div>
                  ))}
                </div>
              )}
              {(detail.rollbacks?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  {detail.rollbacks?.map((r) => (
                    <div key={r.id} className="font-mono text-destructive">
                      {r.id} · {r.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>{detail.error ?? t.recipeForge.proposalDetailsLoading}</div>
          )}
        </div>
      )}
      {run.best_rationale && (
        <div className="mt-1 italic text-muted-foreground">
          “{run.best_rationale.slice(0, 200)}”
        </div>
      )}
    </div>
  );
}
