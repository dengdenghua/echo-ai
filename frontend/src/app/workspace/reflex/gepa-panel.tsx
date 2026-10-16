/**
 * RecipeForge panel · embedded in the reflex monitor page.
 *
 * Provides 3 things in one card:
 *   1. "Currently applied addendum" status (read-only)
 *   2. Run controls · n_iter / eval_tasks knobs + trigger
 *   3. Last run results · Pareto front + per-candidate
 *      "Apply" button so the operator can promote a winner
 *
 * Backend endpoints used:
 *   GET  /api/evolution/forge/applied         · current addendum
 *   POST /api/evolution/forge/run             · run optimization
 *   POST /api/evolution/forge/apply           · persist winner
 *
 * Design choices
 * --------------
 * * No auto-poll · Forge runs are explicit, expensive (10s of seconds
 *   of LLM time), and the operator should kick them off intentionally
 * * Apply is two-click (button → confirm via inline button reveal)
 *   because the addendum directly affects production planner output
 * * Candidates show their RATIONALE prominently · the real value of
 *   the forge over plain prompt tweaking is the LLM's reasoning chain
 */

import { swallow } from "@/core/utils/log";
import {
  CheckCircleIcon,
  DownloadIcon,
  HistoryIcon,
  PlayIcon,
  Sparkles,
  ShieldCheckIcon,
  Wand2Icon,
  TrendingUpIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";

import { reflexFetch } from "./api";
import { ConvergenceChart } from "./gepa-convergence-chart";
import { PastRunRow } from "./gepa-past-run-row";
import {
  AddendumRow,
  CandidateRow,
  CanaryRow,
  HistoryRow,
  NumberKnob,
} from "./gepa-rows";
import type {
  AddendumEntry,
  AddendumsResp,
  AppliedResp,
  ApplyResp,
  AutoProposeResp,
  CanaryEntry,
  CanaryResp,
  Candidate,
  DeleteAddendumResp,
  RunResp,
  RunsResp,
  StoredRun,
  WinnerProposal,
} from "./gepa-types";

export function GepaPanel() {
  const { t } = useI18n();
  const [applied, setApplied] = useState<AppliedResp | null>(null);
  const [nIter, setNIter] = useState(8);
  const [evalTasks, setEvalTasks] = useState(4);
  const [optimizerBackend, setOptimizerBackend] = useState("native_gepa");
  const [running, setRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [run, setRun] = useState<RunResp | null>(null);
  const [history, setHistory] = useState<StoredRun[]>([]);
  const [addendums, setAddendums] = useState<AddendumEntry[]>([]);
  const [canaries, setCanaries] = useState<CanaryEntry[]>([]);
  const [canarySummary, setCanarySummary] = useState({
    active: 0,
    rolledBack: 0,
    total: 0,
  });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [appliedLoading, setAppliedLoading] = useState(true);
  const [appliedLoadFailed, setAppliedLoadFailed] = useState(false);
  const [canariesLoaded, setCanariesLoaded] = useState(false);
  const [canaryLoadFailed, setCanaryLoadFailed] = useState(false);

  const loadApplied = useCallback(async () => {
    setAppliedLoading(true);
    try {
      const r: AppliedResp = await reflexFetch<AppliedResp>(
        "/api/evolution/forge/applied",
      );
      setApplied(r);
      setAppliedLoadFailed(false);
    } catch (e) {
      swallow(e);
      setAppliedLoadFailed(true);
    } finally {
      setAppliedLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r: RunsResp = await reflexFetch<RunsResp>(
        "/api/evolution/forge/runs?limit=20",
      );
      setHistory(r.runs ?? []);
    } catch (e) {
      swallow(e);
      // History is best-effort · don't surface a fetch error here
      // since the rest of the panel still works without it.
    }
  }, []);

  const loadAddendums = useCallback(async () => {
    try {
      const r: AddendumsResp = await reflexFetch<AddendumsResp>(
        "/api/evolution/forge/addendums",
      );
      setAddendums(r.addendums ?? []);
    } catch (e) {
      swallow(e);
    }
  }, []);

  const loadCanaries = useCallback(async () => {
    try {
      const r: CanaryResp = await reflexFetch<CanaryResp>(
        "/api/evolution/canary?include_all=true&limit=20",
      );
      setCanaries(r.canaries ?? []);
      setCanarySummary({
        active: r.active_count ?? 0,
        rolledBack: r.rolled_back_count ?? 0,
        total: r.total ?? r.canaries?.length ?? 0,
      });
      setCanariesLoaded(true);
      setCanaryLoadFailed(false);
    } catch (e) {
      swallow(e);
      setCanaryLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadApplied();
    void loadHistory();
    void loadAddendums();
    void loadCanaries();
  }, [loadApplied, loadHistory, loadAddendums, loadCanaries]);

  const triggerRun = useCallback(async () => {
    setRunning(true);
    setStatusMsg(t.recipeForge.statusRunInProgress(nIter * 2, nIter * 12));
    setRun(null);
    try {
      const r: RunResp = await reflexFetch<RunResp>(
        `/api/evolution/forge/run?n_iter=${nIter}&eval_tasks=${evalTasks}&optimizer_backend=${encodeURIComponent(optimizerBackend)}`,
        { method: "POST" },
      );
      setRun(r);
      if (!r.ok) {
        setStatusMsg(t.recipeForge.statusRunError(r.error ?? "unknown"));
      } else if ((r.iterations_run ?? 0) === 0) {
        setStatusMsg(
          t.recipeForge.statusNoRun(
            r.history?.[0]?.reason ?? "insufficient data",
          ),
        );
      } else {
        setStatusMsg(
          t.recipeForge.statusRunSuccess(
            String(r.iterations_run),
            r.elapsed_s?.toFixed(1) ?? "?",
            r.front_size ?? 0,
          ),
        );
      }
      void loadHistory();
      void loadCanaries();
    } catch (e) {
      swallow(e);
      setStatusMsg(
        e instanceof Error ? e.message : t.recipeForge.statusRunFailed,
      );
    } finally {
      setRunning(false);
    }
  }, [nIter, evalTasks, optimizerBackend, loadHistory, loadCanaries, t]);

  const triggerAutoPropose = useCallback(async () => {
    setAutoRunning(true);
    setStatusMsg(t.recipeForge.statusAutoProposeInProgress(nIter * 12));
    try {
      const r: AutoProposeResp = await reflexFetch<AutoProposeResp>(
        `/api/evolution/forge/auto-propose?n_iter=${nIter}&eval_tasks=${evalTasks}`,
        { method: "POST" },
      );
      if (!r.ok) {
        setStatusMsg(
          t.recipeForge.statusAutoProposeError(r.error ?? "unknown"),
        );
      } else if ((r.proposals_generated ?? 0) === 0) {
        const skip = r.results?.[0];
        setStatusMsg(
          skip?.skipped
            ? t.recipeForge.statusProposeSkipped(skip.reason ?? "unknown")
            : t.recipeForge.statusNoPropose,
        );
      } else {
        setStatusMsg(
          t.recipeForge.statusProposeSuccess(r.proposals_generated ?? 0),
        );
      }
      void loadHistory();
      void loadCanaries();
    } catch (e) {
      swallow(e);
      setStatusMsg(
        e instanceof Error
          ? e.message
          : t.recipeForge.statusDeleteFailedGeneric,
      );
    } finally {
      setAutoRunning(false);
    }
  }, [nIter, evalTasks, loadHistory, loadCanaries, t]);

  const apply = useCallback(
    async (
      c: Candidate,
      fullPrompt: string,
      opts?: {
        runTs?: number;
        targetRecipeId?: string | null;
        winnerProposal?: WinnerProposal | null;
      },
    ) => {
      const target = opts?.targetRecipeId;
      const where = target
        ? t.recipeForge.recipePrefix + " " + target
        : t.recipeForge.globalScope;
      setStatusMsg(t.recipeForge.statusApplying(c.candidate_id, where));
      try {
        const r = await reflexFetch<ApplyResp>("/api/evolution/forge/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: fullPrompt,
            candidate_id: c.candidate_id,
            avg_score: c.avg_score,
            rationale: c.rationale,
            run_ts: opts?.runTs,
            target_recipe_id: target ?? undefined,
            winner_proposal: opts?.winnerProposal ?? undefined,
          }),
        });
        if (!r.ok) {
          setStatusMsg(t.recipeForge.statusApplyFailed(r.error));
          return;
        }
        setStatusMsg(t.recipeForge.statusApplied(r.scope, r.size, r.path));
        void loadApplied();
        void loadHistory();
        void loadAddendums();
        void loadCanaries();
      } catch (e) {
        swallow(e);
        setStatusMsg(
          e instanceof Error ? e.message : t.recipeForge.statusApplyFailed(""),
        );
      }
    },
    [loadApplied, loadHistory, loadAddendums, loadCanaries, t],
  );

  const applyFromHistory = useCallback(
    (run: StoredRun, scope: "global" | "per_recipe") => {
      if (!run.best_candidate_id || !run.best_prompt) return;
      const candidate: Candidate = {
        candidate_id: run.best_candidate_id,
        avg_score: run.best_avg_score ?? 0,
        task_scores: [],
        rationale: run.best_rationale,
        prompt_preview: run.best_prompt,
      };
      void apply(candidate, run.best_prompt, {
        runTs: run.ts,
        targetRecipeId: scope === "per_recipe" ? run.recipe_id : null,
      });
    },
    [apply],
  );

  const deleteAddendum = useCallback(
    async (entry: AddendumEntry) => {
      const id = entry.scope === "global" ? "__global__" : entry.recipe_id;
      if (!id) return;
      setStatusMsg(t.recipeForge.statusDeleteAddendum);
      try {
        const r = await reflexFetch<DeleteAddendumResp>(
          `/api/evolution/forge/addendums/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          setStatusMsg(t.recipeForge.statusDeleteFailed(r.error));
          return;
        }
        setStatusMsg(
          r.deleted
            ? t.recipeForge.statusDeleted(entry.path)
            : t.recipeForge.statusNothingToDelete,
        );
        void loadApplied();
        void loadAddendums();
        void loadCanaries();
      } catch (e) {
        swallow(e);
        setStatusMsg(
          e instanceof Error
            ? e.message
            : t.recipeForge.statusDeleteFailedGeneric,
        );
      }
    },
    [loadApplied, loadAddendums, loadCanaries, t],
  );

  const clearApplied = useCallback(async () => {
    setStatusMsg(
      t.recipeForge.clearAddendumPath(
        applied?.path ?? "data/forge_planner_addendum.md",
      ),
    );
  }, [applied, t]);

  return (
    <Card className="workspace-panel border-border/50 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          {t.recipeForge.panelTitle}
          <Badge variant="outline" className="text-xs font-normal">
            {t.recipeForge.reflectionPathBadge}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Currently applied */}
        <div className="rounded-lg border border-border-default bg-background/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {t.recipeForge.addendumAppliedTitle}
            </div>
            {appliedLoading && !applied ? (
              <Badge variant="outline">{t.recipeForge.stateLoading}</Badge>
            ) : appliedLoadFailed && !applied ? (
              <Badge variant="outline">{t.recipeForge.stateUnavailable}</Badge>
            ) : applied?.applied ? (
              <Badge className="bg-success/15 text-success hover:bg-success/15">
                <CheckCircleIcon className="mr-1 size-3" />
                {t.recipeForge.addendumLive}
              </Badge>
            ) : (
              <Badge variant="outline">{t.recipeForge.addendumNone}</Badge>
            )}
          </div>
          {appliedLoadFailed && (
            <div
              role="alert"
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>{t.recipeForge.addendumUnavailable}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void loadApplied()}
              >
                {t.reflexPage.retryButton}
              </Button>
            </div>
          )}
          {applied?.applied && (
            <>
              <div className="mt-2 text-xs text-muted-foreground">
                {applied.path} ·{" "}
                {applied.size ? t.recipeForge.addendumBytes(applied.size) : "?"}{" "}
                ·{" "}
                {applied.mtime
                  ? new Date(applied.mtime * 1000).toLocaleString()
                  : "?"}
              </div>
              {applied.content_preview && (
                <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs text-muted-foreground">
                  {applied.content_preview}
                </pre>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={clearApplied}
              >
                <XCircleIcon className="mr-1 size-3" />
                {t.recipeForge.addendumClearButton}
              </Button>
            </>
          )}
        </div>

        {/* Run controls */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border-default bg-background/60 px-4 py-3">
          <NumberKnob
            label={t.recipeForge.knobIterations}
            value={nIter}
            onChange={setNIter}
            min={1}
            max={30}
          />
          <NumberKnob
            label={t.recipeForge.knobEvalTasks}
            value={evalTasks}
            onChange={setEvalTasks}
            min={1}
            max={10}
          />
          <label className="flex min-w-[180px] flex-col gap-1 text-xs text-muted-foreground">
            <span>Optimizer</span>
            <select
              className="h-9 rounded-md border border-border-default bg-background px-2 text-xs text-foreground"
              value={optimizerBackend}
              onChange={(event) => setOptimizerBackend(event.target.value)}
            >
              <option value="native_gepa">native_gepa</option>
              <option value="dspy_gepa">dspy_gepa</option>
              <option value="external_gepa">external_gepa</option>
            </select>
          </label>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={triggerAutoPropose}
            disabled={autoRunning || running}
            size="sm"
            title={t.recipeForge.autoProposeTitle}
          >
            <Wand2Icon className="mr-2 size-4" />
            {autoRunning
              ? t.recipeForge.autoProposeRunning
              : t.recipeForge.autoProposeButton}
          </Button>
          <Button
            onClick={triggerRun}
            disabled={running || autoRunning}
            size="sm"
          >
            <PlayIcon className="mr-2 size-4" />
            {running
              ? t.recipeForge.runForgeRunning
              : t.recipeForge.runForgeButton}
          </Button>
        </div>

        {statusMsg && (
          <div className="text-xs text-muted-foreground">{statusMsg}</div>
        )}

        {/* Last run results · renders even on 0-iter runs (the chart's
            "no iterations yet" placeholder is informative on its own;
            and skipped runs still tell the operator WHY they were
            skipped via the history list). */}
        {run && run.ok && (
          <div className="space-y-3 rounded-lg border border-border-default bg-background/60 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <TrendingUpIcon className="size-4 text-success" />
                {t.recipeForge.paretoFrontTitle(run.front_size ?? 0)}
              </div>
              <span className="text-xs text-muted-foreground">
                {t.recipeForge.iterCount(run.iterations_run ?? 0)} ·{" "}
                {t.recipeForge.elapsedSeconds(run.elapsed_s ?? 0)}
              </span>
            </div>
            <Badge className="w-fit bg-muted-foreground/15 text-xs text-muted-foreground hover:bg-muted-foreground/15">
              {run.optimizer_backend || "native_gepa"}
            </Badge>

            {run.best && (
              <CandidateRow
                candidate={run.best}
                isBest
                runRecipeId={run.recipe_id ?? null}
                onApply={(text, scope) =>
                  apply(run.best!, text, {
                    runTs: run.ts,
                    targetRecipeId:
                      scope === "per_recipe" ? (run.recipe_id ?? null) : null,
                    winnerProposal: run.winner_proposal ?? null,
                  })
                }
                t={t}
              />
            )}

            {/* Convergence chart · always shown when run has any
                history rows · helps the operator decide whether to
                bump n_iter (still climbing) or stop (plateaued). */}
            <ConvergenceChart history={run.history ?? []} t={t} />

            {/* This-run history */}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {t.recipeForge.thisRunHistory(run.history?.length ?? 0)}
              </summary>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
                {(run.history ?? []).map((h, i) => (
                  <HistoryRow key={i} entry={h} t={t} />
                ))}
              </div>
            </details>
          </div>
        )}

        {/* Active addendums · global + per-recipe map */}
        {addendums.length > 0 && (
          <div className="rounded-lg border border-border-default bg-background/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-medium">
                {t.recipeForge.addendumsByScope(addendums.length)}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  asChild
                  title={t.recipeForge.addendumCsvTooltip}
                >
                  <a href="/api/evolution/forge/addendums.csv" download>
                    <DownloadIcon className="mr-1 size-3" />
                    CSV
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={loadAddendums}
                >
                  {t.recipeForge.addendumRefresh}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {addendums.map((a) => (
                <AddendumRow
                  key={a.path}
                  entry={a}
                  onDelete={() => deleteAddendum(a)}
                  t={t}
                />
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t.recipeForge.addendumGlobalHint}
            </div>
          </div>
        )}

        {/* Canary states · active / full / rolled back */}
        <div className="rounded-lg border border-border-default bg-background/60 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheckIcon className="size-4" />
              {t.recipeForge.canaryTitle}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={loadCanaries}
              >
                {t.recipeForge.canaryRefresh}
              </Button>
            </div>
          </div>
          {canaryLoadFailed && (
            <div
              role="alert"
              className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {t.recipeForge.canaryUnavailable}
            </div>
          )}
          <div className="mb-2 text-xs text-muted-foreground">
            {!canariesLoaded && canaryLoadFailed
              ? t.recipeForge.canaryCountsUnavailable
              : !canariesLoaded
                ? t.recipeForge.stateLoading
                : t.recipeForge.canaryCounts(
                    canarySummary.active,
                    canarySummary.rolledBack,
                    canarySummary.total,
                  )}
          </div>
          <div className="space-y-2">
            {!canariesLoaded ? (
              <div className="rounded-md border border-dashed border-border-default px-3 py-2 text-xs text-muted-foreground">
                {canaryLoadFailed
                  ? t.recipeForge.canaryUnavailable
                  : t.recipeForge.stateLoading}
              </div>
            ) : canaries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-default px-3 py-2 text-xs text-muted-foreground">
                {t.recipeForge.canaryEmpty}
              </div>
            ) : (
              canaries.map((c) => (
                <CanaryRow key={c.skill_name} entry={c} t={t} />
              ))
            )}
          </div>
        </div>

        {/* Past runs · cross-session history of all Forge runs */}
        {history.length > 0 && (
          <div className="rounded-lg border border-border-default bg-background/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <HistoryIcon className="size-4" />
                {t.recipeForge.pastRunsTitle(history.length)}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  asChild
                  title={t.recipeForge.pastRunsCsvTooltip}
                >
                  <a href="/api/evolution/forge/runs.csv" download>
                    <DownloadIcon className="mr-1 size-3" />
                    CSV
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={loadHistory}
                >
                  {t.recipeForge.pastRunsRefresh}
                </Button>
              </div>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {history.map((h) => (
                <PastRunRow
                  key={h.ts}
                  run={h}
                  canary={findRunCanary(h, canaries)}
                  onApplyGlobal={() => applyFromHistory(h, "global")}
                  onApplyRecipe={
                    h.recipe_id ? () => applyFromHistory(h, "per_recipe") : null
                  }
                  t={t}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function findRunCanary(
  run: StoredRun,
  canaries: CanaryEntry[],
): CanaryEntry | null {
  const recipeKey = run.recipe_id ?? null;
  const candidateKey = run.best_candidate_id ?? null;
  if (!candidateKey) return null;
  const exact = canaries.find(
    (c) =>
      (c.recipe_id ?? null) === recipeKey &&
      (c.candidate_id ?? null) === candidateKey,
  );
  if (exact) return exact;
  return (
    canaries.find((c) => (c.candidate_id ?? null) === candidateKey) ?? null
  );
}
