import { ActivityIcon, SettingsIcon, ZapIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { getSettingsUxCopy } from "./settings-ux-copy";
import { StreamingDebugSetting } from "./streaming-debug-setting";

type ObservabilityCopy = ReturnType<typeof getSettingsUxCopy>["observability"];

/** Settings › Observability: what the dashboard shows, plus streaming debug. */
export function SettingsObservabilitySection({
  copy,
  onOpenDashboard,
}: {
  copy: ObservabilityCopy;
  onOpenDashboard: () => void;
}) {
  return (
    <section
      aria-labelledby="settings-observability-title"
      className="space-y-6"
    >
      <header className="space-y-1.5">
        <h2
          id="settings-observability-title"
          className="text-lg font-semibold tracking-tight"
        >
          {copy.title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: ActivityIcon,
            title: copy.activityTitle,
            description: copy.activityDescription,
          },
          {
            icon: ZapIcon,
            title: copy.tracesTitle,
            description: copy.tracesDescription,
          },
          {
            icon: SettingsIcon,
            title: copy.healthTitle,
            description: copy.healthDescription,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="rounded-lg border border-border bg-muted/20 p-4"
            >
              <Icon aria-hidden="true" className="mb-3 size-4 text-primary" />
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
      <Button className="w-full sm:w-auto" onClick={onOpenDashboard}>
        {copy.openDashboard}
      </Button>
      <StreamingDebugSetting
        title={copy.debugTitle}
        description={copy.debugDescription}
      />
    </section>
  );
}
