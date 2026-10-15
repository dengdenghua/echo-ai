import { Github as GitHubLogoIcon } from "lucide-react";
import { useMemo } from "react";

import { EchoLockup } from "@/components/brand/echo-wordmark";
import { GITHUB_URL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

export function Footer() {
  const { t } = useI18n();
  const year = useMemo(() => new Date().getFullYear(), []);

  const links = useMemo(
    () => [
      {
        title: t.landingFooter.productTitle,
        items: [
          { label: t.landingFooter.workspaceLink, href: "/workspace" },
          { label: t.landingFooter.aboutLink, href: "/about" },
        ],
      },
      {
        title: t.landingFooter.resourcesTitle,
        items: [
          { label: "GitHub", href: GITHUB_URL },
          {
            label: t.landingFooter.skillMarketLink,
            href: "/workspace/agents?surface=chat&tab=skills",
          },
        ],
      },
      {
        title: t.landingFooter.communityTitle,
        items: [
          { label: "Discord", href: "#" },
          { label: t.landingFooter.wechat, href: "#" },
        ],
      },
    ],
    [t],
  );

  return (
    <footer className="container-md mx-auto mt-32 px-4 sm:px-6">
      <hr className="from-border/0 to-border/0 m-0 h-px w-full border-none bg-linear-to-r via-white/20" />

      <div className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <div className="mb-3 flex items-center text-[var(--echo-ink)]">
            <EchoLockup product="AI" wordmarkClassName="h-4" />
          </div>
          <p className="text-xs leading-relaxed text-[var(--echo-ink-muted)]">
            {t.landingFooter.tagline}
          </p>
        </div>

        {links.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-sm font-semibold text-white/70">
              {group.title}
            </h3>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-sm text-[var(--echo-ink-muted)] transition-colors hover:text-[var(--echo-ink)]"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center justify-center gap-3 border-t border-white/[0.06] py-6">
        <div className="flex items-center gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--echo-ink-muted)] transition-colors hover:text-[var(--echo-ink)]"
          >
            <GitHubLogoIcon className="size-4" />
          </a>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--echo-ink-muted)]">
          <span>&copy; {year}</span>
          <span className="font-semibold text-[var(--echo-ink)]">
            ECHO · AI
          </span>
          <span>· Apache-2.0</span>
        </div>
      </div>
    </footer>
  );
}
