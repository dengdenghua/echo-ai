import { useId } from "react";

import { cn } from "@/lib/utils";

type EchoBrandMarkProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
};

const sizeConfig = {
  sm: "size-6",
  md: "size-9",
  lg: "size-11",
} as const;

/**
 * The Echo orb: the same glowing "E" sphere with crossing orbits that the
 * login page and browser start page draw in CSS, as one scalable SVG so the
 * workspace, favicon and auth pages share a single mark. It carries its own
 * dark sphere, so it reads on both light and dark surfaces.
 */
export function EchoOrbGlyph({ className }: { className?: string }) {
  // useId may contain ":" or "«»", which are not safe inside url(#...).
  const id = `echo-orb-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-core`} cx="38%" cy="30%" r="72%">
          <stop offset="0" stopColor="#dce7ff" />
          <stop offset="0.07" stopColor="#7f97e6" />
          <stop offset="0.42" stopColor="#25357a" />
          <stop offset="1" stopColor="#060914" />
        </radialGradient>
      </defs>
      <ellipse
        cx="24"
        cy="24"
        rx="22.5"
        ry="11"
        transform="rotate(-28 24 24)"
        stroke="#7a97f6"
        strokeOpacity="0.55"
      />
      <circle
        cx="24"
        cy="24"
        r="15.5"
        fill={`url(#${id}-core)`}
        stroke="#97b1ff"
        strokeOpacity="0.5"
      />
      <ellipse
        cx="24"
        cy="24"
        rx="21"
        ry="12.5"
        transform="rotate(42 24 24)"
        stroke="#b977ff"
        strokeOpacity="0.45"
      />
      <text
        x="24"
        y="29.4"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="15.5"
        fontWeight="400"
        fill="#f1f5ff"
      >
        E
      </text>
    </svg>
  );
}

export function EchoBrandMark({ className, size = "md" }: EchoBrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center drop-shadow-[0_0_10px_rgba(93,126,240,0.28)]",
        sizeConfig[size],
        className,
      )}
    >
      <EchoOrbGlyph className="size-full" />
    </span>
  );
}
