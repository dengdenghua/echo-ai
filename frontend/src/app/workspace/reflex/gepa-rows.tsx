import { XCircleIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Translations } from "@/core/i18n/locales/types";

import type {
  AddendumEntry,
  CanaryEntry,
  Candidate,
  HistoryEntry,
} from "./gepa-types";

export function CanaryRow({
  entry,
  t,
}: {
  entry: CanaryEntry;
  t: Translations;
}) {
  const phaseColor =
    entry.phase === "rolled_back"
      ? "bg-destructive/15 text-destructive"
      : entry.phase === "full"
        ? "bg-success/15 text-success"
        : "bg-warning/15 text-warning";
  const dt = entry.entered_ts ? new Date(entry.entered_ts) : null;
  const shortSkill =
    entry.skill_name.length > 72
      ? `${entry.skill_name.slice(0, 72)}...`
      : entry.skill_name;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        entry.phase === "rolled_back"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border-default bg-background/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("text-xs", phaseColor, "hover:" + phaseColor)}>
          {t.recipeForge.canaryPhase(entry.phase)}
        </Badge>
        <span className="min-w-0 max-w-full truncate font-mono text-xs text-muted-foreground">
          {shortSkill}
        </span>
        <span className="font-mono text-xs text-success">
          {t.recipeForge.canaryRate(entry.current_rate ?? 0)}
        </span>
        <span className="text-muted-foreground">
          {t.recipeForge.canarySamples(
            entry.sample_count ?? 0,
            entry.success_count ?? 0,
            entry.failure_count ?? 0,
          )}
        </span>
        {dt && !Number.isNaN(dt.getTime()) && (
          <span className="text-muted-foreground">{dt.toLocaleString()}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {entry.candidate_id && (
          <span>{t.recipeForge.canaryCandidate(entry.candidate_id)}</span>
        )}
        {entry.recipe_id && (
          <span>{t.recipeForge.canaryRecipe(entry.recipe_id)}</span>
        )}
        {entry.proposal_id && (
          <span>{t.recipeForge.canaryProposal(entry.proposal_id)}</span>
        )}
        {typeof entry.avg_score === "number" && (
          <span>{t.recipeForge.bestAvg(entry.avg_score)}</span>
        )}
        {entry.last_rollback_reason && (
          <span className="basis-full text-destructive">
            {t.recipeForge.canaryRollbackReason(entry.last_rollback_reason)}
          </span>
        )}
      </div>
    </div>
  );
}

export function NumberKnob({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        aria-label={label}
        className="w-20 rounded-md border border-border-default bg-background/60 px-2 py-1 text-sm tabular-nums"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
      />
    </div>
  );
}

export function CandidateRow({
  candidate,
  isBest,
  runRecipeId,
  onApply,
  t,
}: {
  candidate: Candidate;
  isBest?: boolean;
  runRecipeId?: string | null;
  onApply: (fullPrompt: string, scope: "global" | "per_recipe") => void;
  t: Translations;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        isBest
          ? "border-success/30 bg-success/5"
          : "border-border-default bg-background/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{candidate.candidate_id}</span>
        {isBest && (
          <Badge className="bg-success/15 text-xs text-success hover:bg-success/15">
            {t.recipeForge.bestBadge}
          </Badge>
        )}
        <span className="font-mono text-sm tabular-nums text-success">
          {candidate.avg_score.toFixed(3)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          [{candidate.task_scores.map((s) => s.toFixed(2)).join(", ")}]
        </span>
        <div className="flex-1" />
        {!confirming ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setConfirming(true)}
          >
            {t.recipeForge.applyButton}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            {runRecipeId && (
              <Button
                size="sm"
                className="h-7 bg-success text-xs hover:bg-success"
                onClick={() => {
                  onApply(candidate.prompt_preview, "per_recipe");
                  setConfirming(false);
                }}
                title={`${t.recipeForge.perRecipeScope} ${runRecipeId}`}
              >
                {t.recipeForge.applyRecipeButton(runRecipeId.slice(0, 12))}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                onApply(candidate.prompt_preview, "global");
                setConfirming(false);
              }}
              title={t.recipeForge.applyGlobalButton}
            >
              {t.recipeForge.applyGlobalButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setConfirming(false)}
            >
              {t.recipeForge.cancelButton}
            </Button>
          </div>
        )}
      </div>
      {candidate.rationale && (
        <div className="mt-1 text-xs italic text-muted-foreground">
          “{candidate.rationale}”
        </div>
      )}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          {t.recipeForge.promptPreview}
        </summary>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs text-muted-foreground">
          {candidate.prompt_preview}
        </pre>
      </details>
    </div>
  );
}

/**
 * One row in the "Addendums by scope" list. Renders the scope as
 * a colored badge (cyan = global, violet = per-recipe), shows the
 * recipe_id (when scoped), file size + mtime, content preview,
 * and an inline two-step delete button.
 */
export function AddendumRow({
  entry,
  onDelete,
  t,
}: {
  entry: AddendumEntry;
  onDelete: () => void;
  t: Translations;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dt = new Date(entry.mtime * 1000);
  const scopeColor =
    entry.scope === "global"
      ? "bg-info/15 text-info"
      : "bg-chart-1/15 text-chart-1";
  return (
    <div className="rounded-md border border-border-default bg-background/40 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn("text-xs", scopeColor, "hover:" + scopeColor)}>
          {entry.scope === "global"
            ? t.recipeForge.globalScope
            : t.recipeForge.perRecipeScope}
        </Badge>
        {entry.recipe_id && (
          <span className="font-mono text-xs text-muted-foreground">
            {t.recipeForge.recipePrefix}: {entry.recipe_id}
          </span>
        )}
        <span className="text-muted-foreground">
          {entry.size}b · {dt.toLocaleString()}
        </span>
        <div className="flex-1" />
        {!confirmDelete ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setConfirmDelete(true)}
          >
            <XCircleIcon className="mr-1 size-3" />
            {t.recipeForge.deleteButton}
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="h-6 bg-destructive text-xs hover:bg-destructive"
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
            >
              {t.recipeForge.confirmDeleteButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              {t.recipeForge.cancelButton}
            </Button>
          </div>
        )}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {t.recipeForge.previewSummary}
        </summary>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs text-muted-foreground">
          {entry.preview}
        </pre>
      </details>
    </div>
  );
}

export function HistoryRow({
  entry,
  t,
}: {
  entry: HistoryEntry;
  t: Translations;
}) {
  if (entry.skipped) {
    return (
      <div className="text-warning">
        {t.recipeForge.historySkipped(
          String(entry.iter ?? "0"),
          entry.reason ?? "",
        )}
      </div>
    );
  }
  if (entry.early_stop) {
    return (
      <div className="text-chart-1">
        {t.recipeForge.historyEarlyStop(String(entry.iter))}
      </div>
    );
  }
  if (entry.iter === 0) {
    return (
      <div className="text-muted-foreground">
        {t.recipeForge.historySeed(String(entry.front_size))}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        entry.improved ? "text-success" : "text-muted-foreground",
      )}
    >
      <span>{t.recipeForge.historyIter(String(entry.iter))}</span>
      <span>
        {entry.parent_id}→{entry.child_id}
      </span>
      <span>avg={entry.child_avg?.toFixed(3) ?? "?"}</span>
      <span>front={entry.front_size}</span>
      {entry.improved && <span>{t.recipeForge.historyImproved}</span>}
      {entry.rationale && (
        <span className="basis-full pl-12 text-xs italic">
          “{entry.rationale.slice(0, 120)}”
        </span>
      )}
    </div>
  );
}
