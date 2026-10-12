import { ArrowRightIcon, Github as GitHubLogoIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { GITHUB_URL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import "./landing.css";

export function Hero({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <section
      className={cn("echo-age-landing-hero", className)}
      aria-labelledby="echo-about-title"
    >
      <div className="echo-age-eyebrow">THE ECHO ECOSYSTEM</div>
      <h1 id="echo-about-title" className="echo-age-title">
        <span>THE AGE OF</span>
        <strong>ECHO</strong>
      </h1>
      <div className="echo-age-subtitle">
        <span />
        <strong>回响纪元</strong>
        <span />
      </div>
      <p className="echo-age-lead">
        <span>Every interaction leaves an echo.</span>
        <small>每一次交互，都留下回响。</small>
      </p>
      <p className="echo-age-landing-description">{t.hero.heroDescription}</p>
      <div className="echo-age-landing-actions">
        <Link
          to="/workspace"
          className="echo-age-landing-cta echo-age-primary-button"
        >
          {t.home.openWorkspace}
          <ArrowRightIcon className="size-4" />
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="echo-age-landing-cta echo-age-secondary-button"
        >
          <GitHubLogoIcon className="size-4" />
          GitHub
        </a>
      </div>
    </section>
  );
}
