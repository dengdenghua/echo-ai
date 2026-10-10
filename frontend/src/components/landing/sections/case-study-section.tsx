import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { Section } from "../section";

// Deterministic per-card gradients. Previously each card pulled a
// ``public/images/<threadId>.jpg`` background, but those JPEG assets were
// corrupted (UTF-8-mangled, ~4.5 MB of unrenderable bytes) and shipped a
// broken background on the landing page. Gradients keep the visual design,
// add zero network weight, and never break.
const CARD_GRADIENTS = [
  "linear-gradient(135deg, #4f46e5 0%, #9333ea 100%)",
  "linear-gradient(135deg, #e11d48 0%, #f59e0b 100%)",
  "linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)",
  "linear-gradient(135deg, #059669 0%, #14b8a6 100%)",
  "linear-gradient(135deg, #c026d3 0%, #7c3aed 100%)",
  "linear-gradient(135deg, #ea580c 0%, #db2777 100%)",
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
