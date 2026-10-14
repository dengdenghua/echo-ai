/**
 * The turn locator: a rail of markers for long conversations that jumps to a turn and shows each turn's run state.
 */
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import {
  agentRunStatusLightClass,
  agentRunStatusLightPulseClass,
} from "../agent-run-status";

import { visibleTurnMarkerWindow } from "./message-list-turns";
import type { TurnLocatorRunState, TurnMarker } from "./message-list-turns";

export function TurnLocatorRail({
  activeKey,
  markers,
  onSelect,
  runState,
}: {
  activeKey: string | null;
  markers: TurnMarker[];
  onSelect: (key: string) => void;
  runState: TurnLocatorRunState;
}) {
  const { t } = useI18n();
  if (markers.length <= 1) return null;
  const visibleMarkers = visibleTurnMarkerWindow(markers, activeKey);
  const firstMarker = markers[0]!;
  const lastMarker = markers[markers.length - 1]!;

  return (
    <nav
      aria-label={t.message.turnLocator}
      className="group/turn-rail absolute top-1/2 left-0 z-20 hidden -translate-y-1/2 md:block"
    >
      <div className="relative flex max-h-[82vh] flex-col items-center gap-1 overflow-hidden px-1 py-1.5">
        <TurnLocatorLimitButton
          active={visibleMarkers[0]?.key === firstMarker.key}
          direction="up"
          label={t.message.jumpToFirstTurn}
          onClick={() => onSelect(firstMarker.key)}
        />
        {visibleMarkers.map((marker) => {
          const active = marker.key === activeKey;
          const label = t.message.turnNumberLabel(marker.number, marker.label);
          return (
            <button
              key={marker.key}
              aria-current={active ? "step" : undefined}
              aria-label={label}
              data-turn-marker-active={active ? "true" : undefined}
              data-turn-marker-kind={marker.kind}
              className={cn(
                "group relative flex w-6 items-center justify-center rounded-full transition-all duration-fast",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
                active
                  ? "opacity-100"
                  : "opacity-0 hover:bg-muted/45 hover:opacity-100 focus-visible:opacity-100 group-hover/turn-rail:opacity-70",
                marker.kind === "phase" ? "h-8" : "h-2.5",
              )}
              onClick={() => onSelect(marker.key)}
              title={label}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-full transition-all duration-fast",
                  marker.kind === "phase"
                    ? cn(
                        "h-8 w-2",
                        active
                          ? "bg-muted-foreground/50"
                          : "bg-muted-foreground/25 group-hover:bg-muted-foreground/40",
                      )
                    : cn(
                        "size-2.5",
                        active
                          ? "bg-muted-foreground/55"
                          : "bg-muted-foreground/30 group-hover:bg-muted-foreground/45",
                      ),
                )}
              />
              {active &&
                marker.key === lastMarker.key &&
                runState !== "done" && (
                  <TurnMarkerStatusLight runState={runState} />
                )}
            </button>
          );
        })}
        <TurnLocatorLimitButton
          active={
            visibleMarkers[visibleMarkers.length - 1]?.key === lastMarker.key
          }
          direction="down"
          label={t.message.jumpToLastTurn}
          onClick={() => onSelect(lastMarker.key)}
        />
      </div>
    </nav>
  );
}

export function TurnMarkerStatusLight({
  runState,
}: {
  runState: Exclude<TurnLocatorRunState, "done">;
}) {
  const pulseClassName = agentRunStatusLightPulseClass(runState);
  const color = agentRunStatusLightClass(runState);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute right-0 bottom-0 size-1.5 rounded-full border border-background",
        color,
      )}
      data-turn-marker-status={runState}
    >
      {pulseClassName && (
        <span
          className={cn(
            "absolute inset-0 rounded-full opacity-70",
            color,
            pulseClassName,
          )}
        />
      )}
    </span>
  );
}

export function TurnLocatorLimitButton({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: "down" | "up";
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === "up" ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      aria-label={label}
      className={cn(
        "relative z-1 flex size-7 items-center justify-center rounded-full bg-background/80 outline-none transition-all",
        "focus-visible:ring-ring/50 focus-visible:ring-2",
        active
          ? "text-muted-foreground opacity-60"
          : "text-muted-foreground opacity-85 hover:bg-muted/55 hover:text-muted-foreground hover:opacity-100",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
