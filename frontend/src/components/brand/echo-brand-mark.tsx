import { cn } from "@/lib/utils";

/**
 * Echo Core light states (ECHO brand book, "Echo Core 灯语"). The frame never
 * changes; only the core dot carries state, and only where the mark stands
 * for live system status. Everywhere else it stays `sync`.
 */
export type EchoCoreState =
  | "sync"
  | "signal"
  | "warning"
  | "resonance"
  | "nano"
  | "breach"
  | "off";

const CORE_FILL: Record<EchoCoreState, string> = {
  sync: "var(--echo-core)",
  signal: "var(--echo-signal)",
  warning: "var(--echo-warning)",
  resonance: "var(--echo-resonance)",
  nano: "var(--echo-nano)",
  breach: "var(--echo-breach)",
  off: "var(--echo-ink-faint)",
};

type EchoGlyphProps = {
  className?: string;
  /** Core light color; defaults to the stable `core` cyan. */
  state?: EchoCoreState;
  /** Breathe the core (the only looping motion ECHO allows). */
  breathe?: boolean;
};

type EchoBrandMarkProps = EchoGlyphProps & {
  size?: "sm" | "md" | "lg";
};

const sizeConfig = {
  sm: "size-6",
  md: "size-9",
  lg: "size-11",
} as const;

/**
 * The ECHO mark: an open frame "E" whose middle bar is the Echo Core dot.
 * Geometry is the brand kit's 64-unit grid, copied exactly. The frame takes
 * `currentColor`, so it reads as ink on Snow and snow on Graphite; the core
 * is always `--echo-core` (or a state color). No gradients, glows or shadows.
 *
 * The name is kept from the retired orb glyph so existing callers compile.
 */
export function EchoOrbGlyph({
  className,
  state = "sync",
  breathe = false,
}: EchoGlyphProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
      data-echo-core={state}
    >
      <path
        d="M50 17H24a7 7 0 0 0-7 7v16a7 7 0 0 0 7 7h26"
        stroke="currentColor"
        strokeWidth="6"
      />
      <circle
        cx="38"
        cy="32"
        r="5"
        fill={CORE_FILL[state]}
        className={cn(
          breathe &&
            "animate-[echo-core-breathe_2.4s_ease-in-out_infinite] motion-reduce:animate-none",
        )}
      />
    </svg>
  );
}

export function EchoBrandMark({
  className,
  size = "md",
  state,
  breathe,
}: EchoBrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center",
        sizeConfig[size],
        className,
      )}
    >
      <EchoOrbGlyph className="size-full" state={state} breathe={breathe} />
    </span>
  );
}
