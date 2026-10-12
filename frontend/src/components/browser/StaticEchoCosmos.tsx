import { useMemo } from "react";

const COSMIC_PARTICLES = Array.from({ length: 110 }, (_, index) => {
  const angle = index * 2.3999632297;
  const radius = 90 + ((index * 39) % 240);
  const wobble = Math.sin(index * 1.73) * 20;

  return {
    cx: 515 + Math.cos(angle) * (radius + wobble) * 1.18,
    cy: 416 + Math.sin(angle) * (radius - wobble) * 0.74,
    radius: 0.65 + (index % 5) * 0.28,
    opacity: 0.25 + (index % 7) * 0.1,
  };
});

export function StaticEchoCosmos() {
  const particles = useMemo(() => COSMIC_PARTICLES, []);

  return (
    // Always ECHO Graphite: the start page backdrop is a dark wallpaper in
    // either scheme, so the --echo-* values below resolve to graphite here.
    <div
      className="browser-start-cosmos"
      data-echo-theme="graphite"
      aria-hidden="true"
    >
      <div className="browser-start-cosmos-bg" />
      <div className="browser-start-stars" />
      <div className="browser-start-aurora browser-start-aurora-blue" />
      <div className="browser-start-aurora browser-start-aurora-violet" />

      <svg
        className="browser-static-echo-field"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          <linearGradient id="echo-start-wave-gradient" x1="0" x2="1">
            <stop
              offset="0"
              style={{ stopColor: "var(--echo-ink)", stopOpacity: 0 }}
            />
            <stop
              offset="0.3"
              style={{ stopColor: "var(--echo-ink)", stopOpacity: 0.5 }}
            />
            <stop
              offset="0.55"
              style={{ stopColor: "var(--echo-core)", stopOpacity: 0.75 }}
            />
            <stop
              offset="0.78"
              style={{ stopColor: "var(--echo-ink)", stopOpacity: 0.45 }}
            />
            <stop
              offset="1"
              style={{ stopColor: "var(--echo-ink)", stopOpacity: 0 }}
            />
          </linearGradient>
          <filter
            id="echo-start-field-glow"
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
            id="echo-start-field-soft-glow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>

        {/* Celestial Wave Arcs */}
        <g className="echo-waves" fill="none">
          <path
            className="echo-wave echo-wave-1"
            d="M-80 463 C 125 292, 275 574, 475 423 S 795 278, 1015 432 S 1350 585, 1680 380"
          />
          <path
            className="echo-wave echo-wave-2"
            d="M-80 457 C 128 310, 282 554, 475 420 S 792 296, 1014 430 S 1358 566, 1680 392"
          />
          <path
            className="echo-wave echo-wave-3"
            d="M-60 489 C 158 340, 298 584, 492 445 S 808 324, 1020 452 S 1370 594, 1660 420"
          />
          <path
            className="echo-wave echo-wave-4"
            d="M-60 422 C 134 278, 296 520, 472 391 S 786 250, 1005 405 S 1356 530, 1660 360"
          />
        </g>

        {/* Orbital Ellipses */}
        <g className="echo-vortex" fill="none">
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

        {/* Static Particle Field */}
        <g className="echo-particles" filter="url(#echo-start-field-glow)">
          {particles.map((particle, index) => (
            <circle
              key={index}
              cx={particle.cx}
              cy={particle.cy}
              r={particle.radius}
              style={{
                fill: index % 7 === 0 ? "var(--echo-core)" : "var(--echo-ink)",
              }}
              opacity={particle.opacity}
            />
          ))}
        </g>

        {/* Central Echo Core: the orbits circle one cyan dot with the
            screen's single soft core glow (same as the login field). */}
        <g className="echo-core">
          <circle
            cx="515"
            cy="416"
            r="40"
            style={{ fill: "var(--echo-core)" }}
            opacity="0.14"
            filter="url(#echo-start-field-soft-glow)"
          />
          <circle
            cx="515"
            cy="416"
            r="5"
            style={{ fill: "var(--echo-core)" }}
          />
        </g>
      </svg>
    </div>
  );
}

export default StaticEchoCosmos;
