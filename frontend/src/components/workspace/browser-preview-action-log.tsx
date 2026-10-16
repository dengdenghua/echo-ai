import {
  ArrowLeftIcon,
  ChevronDownIcon,
  GlobeIcon,
  ImageIcon,
  MonitorIcon,
  MousePointerClickIcon,
  PlayIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { Translations } from "@/core/i18n/locales";
import { cn } from "@/lib/utils";

import type { ActionLogEntry } from "./browser-preview-api";
import type { ScreenshotPointerPoint } from "./browser-preview-model";

// ---------------------------------------------------------------------------
// Action icon helper
// ---------------------------------------------------------------------------

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case "navigate":
      return <GlobeIcon className="size-3 text-info" />;
    case "click":
    case "click_at":
    case "double_click_at":
      return <MousePointerClickIcon className="size-3 text-chart-7" />;
    case "type":
      return <TypeIcon className="size-3 text-success" />;
    case "screenshot":
      return <ImageIcon className="size-3 text-chart-1" />;
    case "viewport":
      return <MonitorIcon className="size-3 text-info" />;
    case "scroll":
      return <ArrowLeftIcon className="size-3 text-muted-foreground" />;
    default:
      return <PlayIcon className="size-3 text-muted-foreground" />;
  }
}

function actionStatusLabel(
  entry: ActionLogEntry,
  t: { actionPending: string; actionSuccess: string; actionFailed: string },
): string {
  if (!entry.status) return t.actionPending;
  if (entry.status === "ok") return t.actionSuccess;
  if (entry.status === "error") return t.actionFailed;
  return entry.status;
}

function actionStatusClass(entry: ActionLogEntry): string {
  if (entry.status === "ok") return "bg-success/10 text-success";
  if (entry.status && entry.status !== "ok") {
    return "bg-destructive/10 text-destructive";
  }
  return "bg-muted text-muted-foreground";
}

function actionCoordinateLabel(entry: ActionLogEntry): string | null {
  const point = actionCoordinatePoint(entry);
  return point ? `${point.x}, ${point.y}` : null;
}

export function actionCoordinatePoint(
  entry: ActionLogEntry,
): Pick<ScreenshotPointerPoint, "x" | "y"> | null {
  const x = entry.metadata?.x;
  const y = entry.metadata?.y;
  if (typeof x === "number" && typeof y === "number") {
    return { x: Math.round(x), y: Math.round(y) };
  }
  const match = entry.detail.match(/x[=:]\s*(\d+).*y[=:]\s*(\d+)/i);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

function actionDetailLabel(
  entry: ActionLogEntry,
  t: { coordinateLabel: (coord: string) => string; noDetail: string },
): string {
  if (entry.error) return entry.error;
  if (entry.detail) return entry.detail;
  const coord = actionCoordinateLabel(entry);
  return coord ? t.coordinateLabel(coord) : t.noDetail;
}

export function actionEntryKey(
  entry: ActionLogEntry,
  absoluteIndex: number,
): string {
  return `${entry.timestamp}-${entry.action}-${absoluteIndex}`;
}

/** The on-demand action log under the preview: the selected action and the
 *  latest actions, each of which can be located on the screenshot. */
export function BrowserActionLogPanel({
  t,
  actionLog,
  actionLogExpanded,
  setActionLogExpanded,
  actionFailureCount,
  actionCoordinateCount,
  selectedAction,
  selectedActionKey,
  setSelectedActionKey,
  focusActionEntry,
  screenshotSize,
  pointerMode,
  visibleActions,
  visibleActionStartIndex,
  logEndRef,
}: {
  t: Translations;
  actionLog: ActionLogEntry[];
  actionLogExpanded: boolean;
  setActionLogExpanded: Dispatch<SetStateAction<boolean>>;
  actionFailureCount: number;
  actionCoordinateCount: number;
  selectedAction: { entry: ActionLogEntry; index: number } | null;
  selectedActionKey: string | null;
  setSelectedActionKey: Dispatch<SetStateAction<string | null>>;
  focusActionEntry: (entry: ActionLogEntry, absoluteIndex: number) => void;
  screenshotSize: { width: number; height: number };
  pointerMode: "click" | "double";
  visibleActions: ActionLogEntry[];
  visibleActionStartIndex: number;
  logEndRef: RefObject<HTMLDivElement | null>;
}) {
  const bp = t.browserPreviewPanel;
  return (
    <div className="shrink-0 border-t">
      <button
        type="button"
        onClick={() => setActionLogExpanded((value) => !value)}
        aria-expanded={actionLogExpanded}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left transition-colors hover:bg-muted/45"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDownIcon
            className={cn(
              "text-muted-foreground size-3 shrink-0 transition-transform",
              !actionLogExpanded && "-rotate-90",
            )}
          />
          <span className="text-muted-foreground truncate text-xs font-medium uppercase tracking-wide">
            {t.browser.actionLog}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {t.browser.actions(actionLog.length)}
          {actionFailureCount > 0
            ? ` · ${bp.failureCount(actionFailureCount)}`
            : ""}
          {actionCoordinateCount > 0
            ? ` · ${bp.coordinateCount(actionCoordinateCount)}`
            : ""}
        </span>
      </button>
      {selectedAction && (
        <div className="border-t border-border-subtle bg-primary/5 px-2 py-1.5 text-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            <ActionIcon action={selectedAction.entry.action} />
            <span className="shrink-0 font-semibold text-foreground/85">
              {bp.selectedAction(selectedAction.entry.action)}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
                actionStatusClass(selectedAction.entry),
              )}
            >
              {actionStatusLabel(selectedAction.entry, bp)}
            </span>
            {actionCoordinateLabel(selectedAction.entry) && (
              <button
                type="button"
                onClick={() =>
                  focusActionEntry(selectedAction.entry, selectedAction.index)
                }
                className="shrink-0 rounded-full border border-primary/25 bg-background/80 px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
                title={bp.locateActionTitle}
              >
                {actionCoordinateLabel(selectedAction.entry)}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedActionKey(null)}
              className="ml-auto grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={bp.deselectTitle}
              aria-label={bp.deselectTitle}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <div className="mt-1 truncate text-muted-foreground">
            {actionDetailLabel(selectedAction.entry, bp)}
          </div>
        </div>
      )}
      {actionLogExpanded && (
        <div className="max-h-52 overflow-auto px-2 pb-2 [&::-webkit-scrollbar]:size-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent">
          {screenshotSize.width > 0 && (
            <p className="py-2 text-xs text-muted-foreground">
              {screenshotSize.width} × {screenshotSize.height} · {pointerMode}
            </p>
          )}
          {actionLog.length === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-xs">
              {t.browser.noActions}
            </p>
          ) : (
            <div className="space-y-1">
              {visibleActions.map((entry, i) => {
                const absoluteIndex = visibleActionStartIndex + i;
                const entryKey = actionEntryKey(entry, absoluteIndex);
                const coordinateLabel = actionCoordinateLabel(entry);
                const failed = Boolean(entry.status && entry.status !== "ok");
                return (
                  <button
                    key={entryKey}
                    type="button"
                    onClick={() => focusActionEntry(entry, absoluteIndex)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-lg border border-border-subtle bg-muted/22 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/38",
                      failed && "border-destructive/25 bg-destructive/8",
                      selectedActionKey === entryKey &&
                        "border-primary/35 bg-primary/10",
                    )}
                  >
                    <div className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-background/75">
                      <ActionIcon action={entry.action} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold text-foreground/85">
                          {entry.action}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium",
                            actionStatusClass(entry),
                          )}
                        >
                          {actionStatusLabel(entry, bp)}
                        </span>
                        {coordinateLabel && (
                          <span className="shrink-0 rounded-full bg-background/75 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                            {coordinateLabel}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                          {new Date(entry.timestamp * 1000).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 truncate text-muted-foreground",
                          failed && "text-destructive/85",
                        )}
                      >
                        {actionDetailLabel(entry, bp)}
                      </div>
                    </div>
                  </button>
                );
              })}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
