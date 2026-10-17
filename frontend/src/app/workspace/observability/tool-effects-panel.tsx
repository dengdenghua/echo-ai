// ═══════════════════════════════════════════════════════════
// PANEL 4 · FENCED TOOL EFFECTS
// Presentational: page.tsx (``ToolEffectsPanel``) polls the receipts
// snapshot and passes the heartbeat in; the retry review dialog lives here.
// ═══════════════════════════════════════════════════════════

import { RefreshCwIcon, RotateCcwIcon, ShieldAlertIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";
import {
  authorizeToolEffectRetry,
  type ToolEffectReceipt,
  type ToolEffectsSnapshot,
} from "@/core/observability/api";

import type { HeartbeatState } from "./observability-types";

export function ToolEffectsPanelView({
  heartbeat,
}: {
  heartbeat: HeartbeatState<ToolEffectsSnapshot>;
}) {
  const { t } = useI18n();
  const { data, loading, error, forbidden, refresh } = heartbeat;
  const [selected, setSelected] = useState<ToolEffectReceipt | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const indeterminate = data.state_counts.indeterminate ?? 0;
  const visibleReceipts = useMemo(
    () =>
      data.receipts.filter(
        (receipt, index) => receipt.state !== "committed" || index < 6,
      ),
    [data.receipts],
  );
  const hasCollapsedReceipts = visibleReceipts.length < data.receipts.length;

  const authorize = useCallback(async () => {
    if (!selected || reason.trim().length < 8) return;
    setSubmitting(true);
    try {
      await authorizeToolEffectRetry(selected, reason.trim());
      toast.success(t.observabilityPage.toolEffects.retryAuthorizedSuccess);
      setSelected(null);
      setReason("");
      refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t.observabilityPage.toolEffects.retryAuthorizationFailed,
      );
    } finally {
      setSubmitting(false);
    }
  }, [reason, refresh, selected, t.observabilityPage.toolEffects]);

  return (
    <>
      <Card className="border-border-default/80 shadow-none">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlertIcon className="size-4 text-warning" />
              {t.observabilityPage.toolEffects.title}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.observabilityPage.toolEffects.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={indeterminate > 0 ? "destructive" : "secondary"}>
              {indeterminate > 0
                ? t.observabilityPage.toolEffects.pendingReview(indeterminate)
                : t.observabilityPage.toolEffects.noPendingReview}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={refresh}
              aria-label={t.observabilityPage.toolEffects.refreshAriaLabel}
            >
              <RefreshCwIcon
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t.observabilityPage.toolEffects.backendLabel} ·{" "}
              {data.backend === "disabled"
                ? t.observabilityPage.toolEffects.backendDisabled
                : data.backend}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1">
              {data.shared_across_hosts
                ? t.observabilityPage.toolEffects.sharedAcrossHosts
                : t.observabilityPage.toolEffects.localCoordination}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t.observabilityPage.toolEffects.committedLabel} ·{" "}
              {data.state_counts.committed ?? 0}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1">
              {t.observabilityPage.toolEffects.runningLabel} ·{" "}
              {(data.state_counts.claimed ?? 0) +
                (data.state_counts.started ?? 0)}
            </span>
          </div>

          {error ? (
            <div className="rounded-lg bg-destructive/8 px-3 py-3 text-xs text-destructive">
              {forbidden
                ? t.observabilityPage.crossTenantAdminRequired
                : t.observabilityPage.toolEffects.loadFailed(error)}
            </div>
          ) : data.receipts.length === 0 ? (
            <div className="rounded-lg bg-muted/30 px-3 py-5 text-center text-xs text-muted-foreground">
              {t.observabilityPage.toolEffects.empty}
            </div>
          ) : (
            <div className="divide-y divide-border-default/70 rounded-lg border border-border-default/70">
              {visibleReceipts.map((receipt) => (
                <div
                  key={receipt.effect_key}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium">
                        {receipt.sucker_id ||
                          t.observabilityPage.toolEffects.unknownTool}
                      </span>
                      <EffectStateBadge state={receipt.state} />
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {t.observabilityPage.toolEffects.receiptMeta(
                        receipt.task_id.slice(0, 12) || "—",
                        receipt.step_id,
                        receipt.fencing_token,
                      )}
                    </div>
                    {receipt.reason && (
                      <p className="mt-1 line-clamp-2 text-xs text-warning">
                        {receipt.reason}
                      </p>
                    )}
                  </div>
                  {receipt.state === "indeterminate" &&
                    data.can_authorize_retry && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 rounded-full text-xs"
                        onClick={() => {
                          setSelected(receipt);
                          setReason("");
                        }}
                      >
                        <RotateCcwIcon className="mr-1.5 size-3" />
                        {t.observabilityPage.toolEffects.reviewAndRetry}
                      </Button>
                    )}
                </div>
              ))}
              {hasCollapsedReceipts && (
                <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {t.observabilityPage.toolEffects.collapsedHistory}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t.observabilityPage.toolEffects.confirmTitle}
            </DialogTitle>
            <DialogDescription>
              {t.observabilityPage.toolEffects.confirmDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            {selected?.sucker_id} · token {selected?.fencing_token}
          </div>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t.observabilityPage.toolEffects.reasonPlaceholder}
            className="min-h-24"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSelected(null)}
              disabled={submitting}
            >
              {t.observabilityPage.toolEffects.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void authorize()}
              disabled={submitting || reason.trim().length < 8}
            >
              {submitting
                ? t.observabilityPage.toolEffects.submitting
                : t.observabilityPage.toolEffects.confirmRetry}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EffectStateBadge({ state }: { state: ToolEffectReceipt["state"] }) {
  const { t } = useI18n();
  const labels: Record<ToolEffectReceipt["state"], string> = {
    claimed: t.observabilityPage.toolEffects.states.claimed,
    started: t.observabilityPage.toolEffects.states.started,
    committed: t.observabilityPage.toolEffects.states.committed,
    indeterminate: t.observabilityPage.toolEffects.states.indeterminate,
    retry_authorized: t.observabilityPage.toolEffects.states.retryAuthorized,
  };
  return (
    <Badge
      variant={state === "indeterminate" ? "destructive" : "secondary"}
      className="h-5 px-1.5 text-xs"
    >
      {labels[state]}
    </Badge>
  );
}
