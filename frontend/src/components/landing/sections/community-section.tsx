import { Github as GitHubLogoIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";

import { Section } from "../section";

export function CommunitySection() {
  const { t } = useI18n();
  const copy = t.aboutPage.community;
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          {copy.title}
        </AuroraText>
      }
      subtitle={copy.subtitle}
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <Link to={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <GitHubLogoIcon />
            {copy.contribute}
          </Link>
        </Button>
      </div>
    </Section>
  );
}
