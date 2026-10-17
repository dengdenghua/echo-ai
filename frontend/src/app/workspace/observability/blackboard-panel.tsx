// ═══════════════════════════════════════════════════════════
// PANEL 2 · BLACKBOARD VIEWER
// Presentational: page.tsx polls the turn list and the selected turn's
// snapshot and passes both heartbeats (plus the selection) in.
// ═══════════════════════════════════════════════════════════

import { DatabaseIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { formatAge, formatValue } from "./observability-format";
import type {
  BlackboardListResp,
  BlackboardSnapResp,
  HeartbeatState,
} from "./observability-types";

export function BlackboardPanelView({
  list,
  snap,
  selected,
  onSelect,
}: {
  list: HeartbeatState<BlackboardListResp>;
  snap: HeartbeatState<BlackboardSnapResp | null>;
  selected: string | null;
  onSelect: (turnId: string) => void;
}) {
  const { t } = useI18n();

  if (list.error) {
    return (
      <ErrorState
        title={
          list.forbidden
            ? t.observabilityPage.crossTenantAdminRequired
            : t.observabilityPage.errorPrefix
        }
        detail={list.forbidden ? undefined : list.error}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            {t.observabilityPage.activeTurns}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {list.data.turns.length === 0 && (
            <div className="text-xs text-muted-foreground">
              {t.observabilityPage.noActiveBlackboard}
            </div>
          )}
          {list.data.turns.map((tr) => (
            <Button
              key={tr.turn_id}
              variant="ghost"
              onClick={() => onSelect(tr.turn_id)}
              aria-pressed={selected === tr.turn_id}
              aria-label={`黑板回合 ${tr.turn_id.slice(0, 18)}`}
              className={cn(
                "h-auto w-full justify-start rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:text-foreground",
                selected === tr.turn_id
                  ? "border-primary/40 bg-primary/10 hover:bg-primary/10"
                  : "border-transparent bg-muted/30 hover:bg-muted/60",
              )}
            >
              <div className="w-full">
                <div className="font-mono text-xs truncate">
                  {tr.turn_id.slice(0, 18)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>
                    {tr.key_count} {t.observabilityPage.keyCount}
                  </span>
                  <span>·</span>
                  <span>{formatAge(tr.age_seconds)}</span>
                </div>
              </div>
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {t.observabilityPage.snapshot}
              {selected && (
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {selected.slice(0, 16)}
                </span>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                list.refresh();
                snap.refresh();
              }}
            >
              <RefreshCwIcon className="size-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!selected && (
            <Empty className="border-0 bg-transparent shadow-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <DatabaseIcon />
                </EmptyMedia>
                <EmptyTitle>{t.observabilityPage.selectTurnHint}</EmptyTitle>
                <EmptyDescription>
                  {t.observabilityPage.selectTurnHintDesc}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {selected &&
            snap.data &&
            Object.keys(snap.data.entries).length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t.observabilityPage.emptyBlackboard}
              </div>
            )}
          {selected && snap.data && (
            <div className="space-y-2">
              {Object.entries(snap.data.entries).map(([k, v]) => (
                <div key={k} className="rounded-md bg-muted/30 p-2 text-xs">
                  <div className="mb-1 font-mono font-semibold text-primary">
                    {k}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {formatValue(v)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
