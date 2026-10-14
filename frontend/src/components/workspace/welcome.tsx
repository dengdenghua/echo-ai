import {
  BarChart3Icon,
  BriefcaseIcon,
  CodeIcon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { EchoLockup } from "@/components/brand/echo-wordmark";
import { type Agent } from "@/core/agents";
import type { ComposerImageInjectionDetail } from "@/components/workspace/chat-input-box/helpers";
import { useI18n } from "@/core/i18n/hooks";
import {
  type StarterId,
  welcomeStartersCopy,
} from "@/core/i18n/locales/welcome-starters";
import { cn } from "@/lib/utils";

const STARTERS: Array<{ id: StarterId; Icon: LucideIcon }> = [
  { id: "daily", Icon: BriefcaseIcon },
  { id: "code", Icon: CodeIcon },
  { id: "data", Icon: BarChart3Icon },
  { id: "doc", Icon: FileTextIcon },
];

/** Puts a starter sentence into the composer, which focuses itself. */
function fillComposer(text: string) {
  const detail: ComposerImageInjectionDetail = { text };
  window.dispatchEvent(
    new CustomEvent("echo:inject-composer-images", { detail }),
  );
}

export function Welcome({
  className,
}: {
  className?: string;
  agent?: Agent | null;
  agentName?: string | null;
}) {
  const { t, locale } = useI18n();
  const starters = welcomeStartersCopy(locale);
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
          <div
            role="group"
            aria-label={starters.label}
            data-testid="welcome-starters"
            className="mt-3 mb-4 grid w-full max-w-xs grid-cols-2 gap-2 sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center"
          >
            {STARTERS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => fillComposer(starters.prompts[id])}
                title={starters.prompts[id]}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-border-default bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {t.welcome.scenes[id]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
