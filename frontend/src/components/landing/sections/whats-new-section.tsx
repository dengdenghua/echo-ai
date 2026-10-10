import MagicBento from "@/components/ui/magic-bento";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { Section } from "../section";

const COLOR = "#0a0a0a";

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
        <MagicBento data={features} />
      </div>
    </Section>
  );
}
