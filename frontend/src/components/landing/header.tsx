import { Github as GitHubLogoIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { EchoAgeLockup } from "@/components/brand/echo-age";
import { GITHUB_URL } from "@/core/config";
import type { Locale } from "@/core/i18n/locale";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import "./landing.css";

export type HeaderProps = {
  className?: string;
  /** External home link for the lockup; defaults to the in-app /about. */
  homeURL?: string;
  /** Kept for API compat · no longer consumed · locale resolves via
   *  the surrounding ``I18nProvider``. */
  locale?: Locale;
};

// NOTE · 2026-04-24 · must stay a synchronous component: the old Next.js
// RSC ``async function Header`` emitted "<Header> is an async Client
// Component" on every /about load (guarded by e2e/regression.spec.ts).
export function Header({ className, homeURL }: HeaderProps) {
  const { t } = useI18n();
  const lockup = <EchoAgeLockup />;
  return (
    <header className={cn("echo-age-landing-bar", className)}>
      <div className="echo-age-landing-bar-inner">
        {homeURL ? (
          <a href={homeURL} className="echo-age-landing-lockup">
            {lockup}
          </a>
        ) : (
          <Link to="/about" className="echo-age-landing-lockup">
            {lockup}
          </Link>
        )}
        <nav className="echo-age-landing-nav">
          <Link to="/workspace">{t.home.openWorkspace}</Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <GitHubLogoIcon className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
