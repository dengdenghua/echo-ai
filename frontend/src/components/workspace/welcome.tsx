import { useSearchParams } from "react-router-dom";

import { EchoLockup } from "@/components/brand/echo-wordmark";
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
        // Same "ECHO · AI" lockup and line as the login page, so signing in continues
        // the brand instead of switching to a different product.
        <div className="flex flex-col items-center gap-3">
          <h2 className="inline-flex items-center justify-center text-foreground">
            <EchoLockup
              product="AI"
              wordmarkClassName="h-7 sm:h-8"
              productClassName="text-sm"
            />
          </h2>
          <p className="text-sm text-muted-foreground">{t.welcome.brandLine}</p>
        </div>
      )}
    </div>
  );
}
