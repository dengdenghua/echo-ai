import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import "./echo-age.css";

/*
 * ECHO AGE 回响纪元 brand primitives. The login page is the source of
 * truth; these are lifted from it so register, /about, the desktop
 * fallback card and the workspace welcome all draw the same mark.
 */

export type EchoAgeMarkSize = "sm" | "md" | "lg";

const MARK_SIZE_CLASS: Record<EchoAgeMarkSize, string | undefined> = {
  sm: "echo-age-mark-sm",
  md: undefined,
  lg: "echo-age-mark-lg",
};

/** Sphere "E" mark: a glowing orb with three tilted orbits (sm 32 · md 42 · lg 56px). */
export function EchoAgeMark({
  className,
  size = "md",
}: {
  className?: string;
  size?: EchoAgeMarkSize;
}) {
  return (
    <span
      className={cn("echo-age-mark", MARK_SIZE_CLASS[size], className)}
      aria-hidden="true"
    >
      <i />
      <b>E</b>
    </span>
  );
}

/** Mark + "ECHO AGE" + 回响纪元. `md` matches the login header. */
export function EchoAgeLockup({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "echo-age-lockup",
        size === "sm" && "echo-age-lockup-sm",
        className,
      )}
      role="img"
      aria-label="ECHO AGE 回响纪元"
    >
      <EchoAgeMark size={size === "sm" ? "sm" : "md"} />
      <span className="echo-age-lockup-copy">
        <strong>ECHO AGE</strong>
        <small>回响纪元</small>
      </span>
    </span>
  );
}

const ECHO_PARTICLES = Array.from({ length: 148 }, (_, index) => {
  const angle = index * 2.3999632297;
  const radius = 94 + ((index * 37) % 225);
  const wobble = Math.sin(index * 1.73) * 22;

  return {
    cx: 515 + Math.cos(angle) * (radius + wobble) * 1.16,
    cy: 416 + Math.sin(angle) * (radius - wobble) * 0.72,
    radius: 0.65 + (index % 5) * 0.28,
    opacity: 0.2 + (index % 7) * 0.1,
    delay: `${-((index * 0.17) % 6).toFixed(2)}s`,
  };
});

/** Animated wave / vortex / particle field behind the brand surfaces. */
export function EchoAgeField({ className }: { className?: string }) {
  return (
    <svg
      className={cn("echo-age-field", className)}
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
    >
      <defs>
        <linearGradient id="echo-wave-gradient" x1="0" x2="1">
          <stop offset="0" stopColor="#5b82ff" stopOpacity="0" />
          <stop offset="0.25" stopColor="#748fff" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#b08cff" />
          <stop offset="0.78" stopColor="#70dfff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#5b82ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="echo-core-gradient" cx="38%" cy="30%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.08" stopColor="#b9c9ff" />
          <stop offset="0.36" stopColor="#586bd5" />
          <stop offset="0.72" stopColor="#171b51" />
          <stop offset="1" stopColor="#070812" />
        </radialGradient>
        <filter
          id="echo-field-glow"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter
          id="echo-field-soft-glow"
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>

      <g className="echo-age-waves" fill="none">
        <path
          className="echo-age-wave echo-age-wave-1"
          d="M-80 463 C 125 292, 275 574, 475 423 S 795 278, 1015 432 S 1350 585, 1680 380"
        />
        <path
          className="echo-age-wave echo-age-wave-2"
          d="M-80 457 C 128 310, 282 554, 475 420 S 792 296, 1014 430 S 1358 566, 1680 392"
        />
        <path
          className="echo-age-wave echo-age-wave-3"
          d="M-60 489 C 158 340, 298 584, 492 445 S 808 324, 1020 452 S 1370 594, 1660 420"
        />
        <path
          className="echo-age-wave echo-age-wave-4"
          d="M-60 422 C 134 278, 296 520, 472 391 S 786 250, 1005 405 S 1356 530, 1660 360"
        />
      </g>

      <g className="echo-age-vortex" fill="none">
        <ellipse cx="515" cy="416" rx="306" ry="208" />
        <ellipse
          cx="515"
          cy="416"
          rx="280"
          ry="225"
          transform="rotate(28 515 416)"
        />
        <ellipse
          cx="515"
          cy="416"
          rx="246"
          ry="171"
          transform="rotate(-18 515 416)"
        />
        <ellipse
          cx="515"
          cy="416"
          rx="215"
          ry="145"
          transform="rotate(38 515 416)"
        />
      </g>

      <g className="echo-age-particles" filter="url(#echo-field-glow)">
        {ECHO_PARTICLES.map((particle, index) => (
          <circle
            className="echo-age-particle"
            key={index}
            cx={particle.cx}
            cy={particle.cy}
            r={particle.radius}
            opacity={particle.opacity}
            style={{ animationDelay: particle.delay }}
          />
        ))}
      </g>

      <g className="echo-age-core">
        <circle
          cx="515"
          cy="416"
          r="54"
          fill="#6e75ff"
          opacity="0.2"
          filter="url(#echo-field-soft-glow)"
        />
        <circle
          cx="515"
          cy="416"
          r="34"
          fill="url(#echo-core-gradient)"
          stroke="#93aaff"
          strokeOpacity="0.5"
        />
        <text
          x="515"
          y="425"
          textAnchor="middle"
          fill="#f5f7ff"
          fontSize="25"
          fontWeight="350"
        >
          E
        </text>
      </g>
    </svg>
  );
}

/**
 * Decorative backdrop: star dust + two breathing auroras + the field.
 * `fixed` pins it to the viewport on long scrolling pages; `field={false}`
 * drops the animated SVG for surfaces that may sit idle for hours.
 */
export function EchoAgeCosmos({
  className,
  field = true,
  fixed = false,
}: {
  className?: string;
  field?: boolean;
  fixed?: boolean;
}) {
  return (
    <div
      className={cn(
        "echo-age-cosmos",
        fixed && "echo-age-cosmos-fixed",
        className,
      )}
      aria-hidden="true"
    >
      <div className="echo-age-stars" />
      <div className="echo-age-aurora echo-age-aurora-blue" />
      <div className="echo-age-aurora echo-age-aurora-violet" />
      {field && <EchoAgeField />}
    </div>
  );
}

/** Root of a cosmic page: theme-token overrides + backdrop + content. */
export function EchoAgeShell({
  children,
  className,
  cosmos,
  embedded = false,
}: {
  children: ReactNode;
  className?: string;
  /** Props for the backdrop; pass `false` to omit it. */
  cosmos?: { field?: boolean; fixed?: boolean } | false;
  /** Leave room for the Echo OS traffic lights when hosted in an iframe. */
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        "echo-age-shell relative min-h-screen overflow-hidden",
        embedded && "echo-age-shell-embedded",
        className,
      )}
    >
      {cosmos !== false && <EchoAgeCosmos {...cosmos} />}
      {children}
    </div>
  );
}

/** Auth-page header: lockup, decorative section ticker, status pill. */
export function EchoAgeHeader({ status }: { status: string }) {
  return (
    <header className="echo-age-header">
      <EchoAgeLockup />
      <nav className="echo-age-header-nav" aria-hidden="true">
        <span>PRODUCT</span>
        <i />
        <span>MEMORY</span>
        <i />
        <span>AGENTS</span>
        <i />
        <span>VISION</span>
      </nav>
      <div className="echo-age-header-status">
        {status}
        <span />
      </div>
    </header>
  );
}

export function EchoAgeFooter({ className }: { className?: string }) {
  return (
    <p className={cn("echo-age-footer", className)}>
      AN AGE BEGINS · © {new Date().getFullYear()} ECHO AGE
    </p>
  );
}
