import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import "../landing.css";

// English labels mirror the login page continuum (01 MEMORY … 04 GROW);
// localized titles and descriptions come from ``t.hero.pillars``.
const PILLARS = [
  { key: "memory", label: "MEMORY" },
  { key: "understand", label: "UNDERSTAND" },
  { key: "act", label: "ACT" },
  { key: "grow", label: "GROW" },
] as const;

export function PillarsSection({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <section
      className={cn("echo-age-landing-pillars", className)}
      aria-labelledby="echo-about-pillars"
    >
      <div className="echo-age-card-kicker">
        <span /> THE ECHO CONTINUUM
      </div>
      <h2 id="echo-about-pillars">{t.hero.pillarsTitle}</h2>
      <ol className="echo-age-landing-pillar-grid">
        {PILLARS.map((pillar, index) => {
          const copy = t.hero.pillars[pillar.key];
          return (
            <li
              key={pillar.key}
              className="echo-age-card echo-age-landing-pillar"
            >
              <span className="echo-age-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className="echo-age-landing-pillar-label"
                aria-hidden="true"
              >
                {pillar.label}
              </span>
              <h3>{copy.title}</h3>
              <p>{copy.description}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
