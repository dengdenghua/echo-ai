/**
 * Which HUB section and view a URL opens.
 */

export const LOCAL_LIBRARY_INSTALLED_ONLY = false;
// Only the system-level admin persona is hidden from the hub;
// desktop_operator (Raven) is a first-class user-facing CUA persona
// since #22 (CUA productization).
export const HIDDEN_LOCAL_AGENT_IDS = new Set(["admin"]);

export type HubMarketSection = "agents" | "applications" | "skills";
export type HubApplicationView =
  | "featured"
  | "all"
  | "installed"
  | "codex"
  | "skills"
  | "library"
  | "remote";
export type HubTalentView = "roles" | "cloud" | "experts" | "teams" | "remote";

export function resolveHubMarketRoute(search: string): {
  section: HubMarketSection;
  applicationView: HubApplicationView;
} {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "agents" || tab === "enterprise") {
    return { section: "agents", applicationView: "all" };
  }
  if (tab === "skills" || tab === "skill-packs") {
    return { section: "skills", applicationView: "all" };
  }
  if (tab === "plugins" || tab === "packs") {
    const view = new URLSearchParams(search).get("view");
    if (view === "remote") return { section: "agents", applicationView: "all" };
    return {
      section: "applications",
      applicationView:
        view === "installed" || view === "all" ? view : "featured",
    };
  }
  if (tab === "codex-plugins") {
    return { section: "applications", applicationView: "codex" };
  }
  if (tab === "assets") {
    return { section: "applications", applicationView: "all" };
  }
  return { section: "agents", applicationView: "all" };
}

export function resolveHubTalentView(search: string): HubTalentView {
  const talent = new URLSearchParams(search).get("talent");
  if (
    talent === "cloud" ||
    talent === "experts" ||
    talent === "teams" ||
    talent === "remote"
  ) {
    return talent;
  }
  return "roles";
}
