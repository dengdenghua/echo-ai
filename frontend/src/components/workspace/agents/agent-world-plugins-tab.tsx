import { DEFAULT_FEATURED_APP_IDS } from "@/components/store/app-marketplace-panel";
import { CapabilityMarketPanel } from "@/components/store/capability-market-panel";
import { CreateAssetButton } from "@/components/store/create-asset-button";
import type { HubCopy } from "@/core/i18n/locales/hub";
import { cn } from "@/lib/utils";
import type { HubApplicationView } from "./hub-routes";

type PluginsCopy = HubCopy["plugins"];

/**
 * The Plugins tab of the agent world.
 *
 * Extracted from `agent-world-unified.tsx` so that file stays within its size
 * budget: this tab is self-contained (a directory-view switcher plus the
 * capability market) and needs nothing from the page except the current route
 * view and the search query.
 */
export function AgentWorldPluginsTab({
  copy,
  view,
  activeView,
  searchQuery,
  onViewChange,
}: {
  copy: PluginsCopy;
  view: "featured" | "all" | "installed";
  activeView: HubApplicationView;
  searchQuery: string;
  onViewChange: (view: "featured" | "all" | "installed" | "remote") => void;
}) {
  return (
    <section>
      <div className="mb-3 flex justify-end">
        <CreateAssetButton kind="plugin" />
      </div>
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              {view === "featured" ? copy.featuredHeading : copy.allHeading}
            </h3>
            <p className="mt-1 text-ui text-muted-foreground">
              {view === "featured" ? copy.featuredHint : copy.allHint}
            </p>
          </div>
          <div
            role="tablist"
            aria-label={copy.viewLabel}
            className="flex w-fit items-center rounded-lg bg-muted/60 p-1"
          >
            {(
              [
                ["featured", copy.featured],
                ["all", copy.all],
                ["installed", copy.installed],
              ] as const
            ).map(([nextView, label]) => (
              <button
                key={nextView}
                type="button"
                role="tab"
                aria-selected={activeView === nextView}
                onClick={() => onViewChange(nextView)}
                className={cn(
                  "h-7 rounded-md px-3 text-ui transition-colors",
                  activeView === nextView
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <CapabilityMarketPanel
          searchQuery={searchQuery}
          view={view}
          featuredIds={DEFAULT_FEATURED_APP_IDS}
          maxItems={view === "featured" ? 7 : undefined}
          showToolbar={false}
          compact
        />
      </div>
    </section>
  );
}
