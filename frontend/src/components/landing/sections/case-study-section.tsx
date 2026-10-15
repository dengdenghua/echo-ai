import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { Section } from "../section";

// ECHO card covers: a graphite ground with one cyan core glow per card.
// The family palette is monochrome — the core is the only hue (brand book:
// "no gold or rainbow"), so each card varies the glow's position and
// strength instead of inventing new colors. The colors resolve through
// the ECHO tokens; this section renders on the pinned-graphite shell.
const CARD_GRADIENTS = [
  "radial-gradient(115% 85% at 20% 18%, color-mix(in srgb, var(--echo-core) 20%, transparent) 0%, transparent 58%), linear-gradient(155deg, var(--echo-surface) 0%, var(--echo-ground) 100%)",
  "radial-gradient(105% 80% at 82% 22%, color-mix(in srgb, var(--echo-core) 14%, transparent) 0%, transparent 55%), linear-gradient(155deg, var(--echo-ground) 0%, var(--echo-surface) 100%)",
  "radial-gradient(120% 90% at 50% 88%, color-mix(in srgb, var(--echo-core) 24%, transparent) 0%, transparent 60%), linear-gradient(155deg, var(--echo-ground) 0%, var(--echo-surface) 100%)",
  "radial-gradient(100% 75% at 26% 76%, color-mix(in srgb, var(--echo-core) 12%, transparent) 0%, transparent 52%), linear-gradient(155deg, var(--echo-surface) 0%, var(--echo-ground) 100%)",
  "radial-gradient(110% 82% at 74% 30%, color-mix(in srgb, var(--echo-core) 18%, transparent) 0%, transparent 56%), linear-gradient(155deg, var(--echo-ground) 0%, var(--echo-surface) 100%)",
  "radial-gradient(118% 88% at 48% 24%, color-mix(in srgb, var(--echo-core) 22%, transparent) 0%, transparent 59%), linear-gradient(155deg, var(--echo-surface) 0%, var(--echo-ground) 100%)",
];

export function CaseStudySection({ className }: { className?: string }) {
  const { t } = useI18n();
  const copy = t.aboutPage.caseStudies;
  return (
    <Section
      className={className}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <div className="container-md mt-8 grid grid-cols-1 gap-4 px-4 sm:px-8 lg:px-20 md:grid-cols-2 lg:grid-cols-3">
        {copy.items.map((caseStudy, index) => (
          // A new chat with the case's prompt: the demo threads these
          // cards used to open never existed in a user's own instance.
          <Link
            key={caseStudy.title}
            to={`/workspace/realtime/new?prompt=${encodeURIComponent(caseStudy.prompt)}`}
            title={copy.tryPrompt}
          >
            <Card className="group/card relative h-64 overflow-hidden">
              <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-slow group-hover/card:scale-110 group-hover/card:brightness-90"
                style={{
                  backgroundImage:
                    CARD_GRADIENTS[index % CARD_GRADIENTS.length],
                }}
              ></div>
              <div
                className={cn(
                  "flex h-full w-full translate-y-[calc(100%-60px)] flex-col items-center",
                  "transition-all duration-slow",
                  "group-hover/card:translate-y-[calc(100%-128px)]",
                )}
              >
                <div
                  className="flex w-full flex-col p-4"
                  style={{
                    background:
                      "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 100%)",
                  }}
                >
                  <div className="flex flex-col gap-2">
                    <h3 className="flex h-14 items-center text-xl font-bold text-shadow-black">
                      {caseStudy.title}
                    </h3>
                    <p className="box-shadow-black overflow-hidden text-sm text-white/85 text-shadow-black">
                      {caseStudy.prompt}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Section>
  );
}
