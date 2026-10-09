import { useSearchParams } from "react-router-dom";

import { EchoBrandMark } from "@/components/brand/echo-brand-mark";
import { type Agent } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function Welcome({
  className,
}: {
  className?: string;
  agent?: Agent | null;
  agentName?: string | null;
}) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const isSkillSeed = searchParams.get("mode") === "skill";

  return (
    <div
      data-composer-welcome="true"
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center px-5 pt-8 pb-6 text-center sm:px-8",
        className,
      )}
    >
      {isSkillSeed ? (
        <>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-2xl font-semibold tracking-tight">
            {t.welcome.createYourOwnSkill}
          </div>
          <p className="max-w-xl text-muted-foreground/90 whitespace-pre-line text-sm leading-relaxed">
            {t.welcome.createYourOwnSkillDescription}
          </p>
        </>
      ) : (
        // Same orb mark and line as the login page, so signing in continues
        // the brand instead of switching to a different product.
        <div className="flex flex-col items-center gap-2.5">
          <div className="inline-flex items-center justify-center gap-3">
            <EchoBrandMark size="lg" className="sm:size-12" />
            <h2 className="whitespace-nowrap text-[28px] leading-tight font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">
              Echo
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {t.welcome.brandLine}
          </p>
        </div>
      )}
    </div>
  );
}
