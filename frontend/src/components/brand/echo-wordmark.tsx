import { cn } from "@/lib/utils";

/**
 * The ECHO wordmark, drawn from the brand kit's `echo-wordmark-*.svg`
 * geometry (never typeset in a font). Strokes take `currentColor`, so it
 * reads graphite on Snow and snow on Graphite; the E's core dot is always
 * `--echo-core`. Size it by height (`h-*`); the width follows the 174:36
 * viewBox.
 */
export function EchoWordmark({
  className,
  title = "ECHO",
}: {
  className?: string;
  /** Accessible name; pass `null` when a sibling already names it. */
  title?: string | null;
}) {
  return (
    <svg
      viewBox="14 14 174 36"
      fill="none"
      className={cn("h-6 w-auto shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      data-echo-wordmark=""
    >
      <g stroke="currentColor" strokeWidth="6">
        <path d="M50 17H24a7 7 0 0 0-7 7v16a7 7 0 0 0 7 7h26" />
        <path d="M93 17H67a7 7 0 0 0-7 7v16a7 7 0 0 0 7 7h26" />
        <path d="M104 14v36M137 14v36M104 32h33" />
        <rect x="152" y="17" width="33" height="30" rx="7" />
      </g>
      <circle cx="38" cy="32" r="5" fill="var(--echo-core)" />
    </svg>
  );
}

/**
 * Product lockup: the wordmark with the product name to its right in the
 * telemetry style (`ECHO · AI`). The accessible name is the product name.
 */
export function EchoLockup({
  product = "AI",
  className,
  wordmarkClassName,
  productClassName,
}: {
  product?: string;
  className?: string;
  wordmarkClassName?: string;
  productClassName?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`ECHO ${product}`}
      className={cn("inline-flex items-center gap-2.5", className)}
      data-echo-lockup={product}
    >
      <EchoWordmark title={null} className={wordmarkClassName} />
      <span
        aria-hidden="true"
        lang="en"
        className={cn(
          "font-mono text-xs uppercase tracking-caps whitespace-nowrap text-muted-foreground",
          productClassName,
        )}
      >
        · {product}
      </span>
    </span>
  );
}
