import MagicBento from "@/components/ui/magic-bento";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { Section } from "../section";

// Card surface token; /about pins data-echo-theme="graphite".
const COLOR = "var(--card)";
// MagicBento takes an "r, g, b" triplet: the Graphite core (#6fe3f0).
const GLOW = "111, 227, 240";

export function WhatsNewSection({ className }: { className?: string }) {
  const { t } = useI18n();
  const copy = t.aboutPage.whatsNew;
  const features = copy.features.map((feature) => ({
    color: COLOR,
    ...feature,
  }));
  return (
    <Section
      className={cn("", className)}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <div className="flex w-full items-center justify-center">
        <MagicBento data={features} glowColor={GLOW} />
      </div>
    </Section>
  );
}
