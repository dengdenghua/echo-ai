import { useMemo } from "react";
import { Link } from "react-router-dom";

import { EchoAgeLockup } from "@/components/brand/echo-age";
import { GITHUB_URL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

import "./landing.css";

type FooterLink =
  | { label: string; to: string }
  | { label: string; href: string };

export function Footer() {
  const { t } = useI18n();
  const year = useMemo(() => new Date().getFullYear(), []);

  const groups = useMemo<{ title: string; items: FooterLink[] }[]>(
    () => [
      {
        title: t.landingFooter.productTitle,
        items: [
          { label: t.landingFooter.workspaceLink, to: "/workspace" },
          { label: t.landingFooter.aboutLink, to: "/about" },
        ],
      },
      {
        title: t.landingFooter.resourcesTitle,
        items: [
          { label: "GitHub", href: GITHUB_URL },
          {
            label: t.landingFooter.skillMarketLink,
            to: "/workspace/agents?surface=chat&tab=skills",
          },
        ],
      },
    ],
    [t],
  );

  return (
    <footer className="echo-age-landing-footer">
      <div className="echo-age-landing-footer-grid">
        <div>
          <EchoAgeLockup size="sm" />
          <p className="echo-age-landing-tagline">{t.landingFooter.tagline}</p>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <h3>{group.title}</h3>
            <ul className="echo-age-landing-links">
              {group.items.map((item) => (
                <li key={item.label}>
                  {"to" in item ? (
                    // Hash router: in-app routes must go through <Link>.
                    <Link to={item.to}>{item.label}</Link>
                  ) : (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="echo-age-footer echo-age-landing-legal">
        AN AGE BEGINS · © {year} ECHO AGE · APACHE-2.0
      </p>
    </footer>
  );
}
