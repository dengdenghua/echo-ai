import { agentCreationRoute } from "@/core/agents/creation-route";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BotIcon,
  ChevronDownIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ACTIVE_AGENT_KEY, useActiveAgentId } from "@/core/agents/active";
import { emitAgentChanged } from "@/core/events";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { swallow } from "@/core/utils/log";
import { serviceErrorMessage } from "@/core/utils/service-error";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import {
  fetchRuntimePluginStatus,
  installCloudPlugin,
  rollbackCloudPlugin,
  setCloudPluginEnabled,
  uninstallCloudPlugin,
  type RuntimePluginStatus,
} from "@/core/agents/agent-world-api";
import { listAgents as listLocalAgents } from "@/core/agents/api";
import { waitForBackendAvailability } from "@/core/backend/readiness";
import type { AgentWorldAgent } from "@/core/agents/types";
import {
  DEFAULT_PRIMARY_AGENT_ID,
  isPrimaryPersonaAgentId,
} from "@/core/agents/persona-policy";
import {
  setModuleEnabled,
  setModuleAvailable,
  useEnabledModuleIds,
} from "@/core/modules/enabled-modules";
import {
  loadWorkbenchAvailabilitySnapshot,
  syncWorkbenchAvailability,
} from "@/core/workbench/availability";
import {
  WORKBENCH_BUILTIN_APPS,
  type WorkbenchBuiltinApp,
} from "@/core/workbench/apps";
import {
  useCanManageWorkbenches,
  workbenchActionErrorMessage,
} from "@/core/workbench/workbench-permissions";
import { WORKBENCH_APP_ICONS } from "@/components/workspace/module-icons";
import { CapabilityMarketPanel } from "@/components/store/capability-market-panel";
import { DEFAULT_FEATURED_APP_IDS } from "@/components/store/app-marketplace-panel";
import { A2AAgentsPanel } from "@/components/workspace/a2a-agents-panel";
import { CloudSkillsPanel } from "@/components/store/cloud-skills-panel";
import { WorkBuddyCloudStorePanel } from "@/components/store/workbuddy-cloud-store-panel";
import { SmartTeamDialog } from "./smart-team-dialog";
import {
  RestoreWorkbenchDialog,
  UninstallWorkbenchDialog,
} from "./workbench-app-dialogs";
import { hubCopy } from "@/core/i18n/locales/hub";
import { OnDemandStoreSections } from "./plugin-store-section";
import {
  WorkbenchInstallControl,
  WorkbenchManageMenu,
  WorkbenchStatusLine,
} from "./workbench-app-actions";
import { localAgentToWorldAgent } from "./agent-world-data";
import {
  resolveHudAgent,
  dedupeAgentWorldAgents,
} from "./agent-world-identity";
import { AgentsTab } from "./agents-tab";
import {
  LOCAL_LIBRARY_INSTALLED_ONLY,
  HIDDEN_LOCAL_AGENT_IDS,
  resolveHubMarketRoute,
} from "./hub-routes";
import type { HubMarketSection } from "./hub-routes";

export {
  agentWorldIdentityKey,
  resolveHudAgent,
  dedupeAgentWorldAgents,
} from "./agent-world-identity";
export { AgentsTab } from "./agents-tab";
export { resolveHubMarketRoute, resolveHubTalentView } from "./hub-routes";
export type {
  HubMarketSection,
  HubApplicationView,
  HubTalentView,
} from "./hub-routes";
/* Implementation note. */

const AgentRoleProfileDialog = lazy(() =>
  import("./agent-role-profile-dialog").then((module) => ({
    default: module.AgentRoleProfileDialog,
  })),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Types + data + helpers extracted to agent-world-data.ts

export function AgentWorldUnified() {
  const { t, locale } = useI18n();
  const hub = hubCopy(locale);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeAgentId = useActiveAgentId() ?? DEFAULT_PRIMARY_AGENT_ID;
  const enabledModuleIds = useEnabledModuleIds(activeAgentId);
  const enabledModuleIdSet = useMemo(
    () => new Set(enabledModuleIds),
    [enabledModuleIds],
  );

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const matchingApps = WORKBENCH_BUILTIN_APPS.filter((app) =>
    `${app.id} ${app.name} ${app.description}`
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  );
  const marketRoute = useMemo(
    () => resolveHubMarketRoute(location.search),
    [location.search],
  );
  const pluginDirectoryView =
    marketRoute.applicationView === "featured" ||
    marketRoute.applicationView === "installed"
      ? marketRoute.applicationView
      : "all";
  const [activeMarket, setActiveMarket] = useState<HubMarketSection>(
    () => marketRoute.section,
  );
  const [selectedAgent, setSelectedAgent] = useState<AgentWorldAgent | null>(
    null,
  );
  const [hubSmartTeamOpen, setHubSmartTeamOpen] = useState(false);
  const [remoteAgentsOpen, setRemoteAgentsOpen] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("view") === "remote" || params.get("talent") === "remote") {
      setRemoteAgentsOpen(true);
    }
  }, [location.search]);
  const hudOnly = new URLSearchParams(location.search).get("hud") === "1";
  const requestedAgentName =
    new URLSearchParams(location.search).get("agent")?.trim() || "";

  // Data
  const [agents, setAgents] = useState<AgentWorldAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentsLoadError, setAgentsLoadError] = useState(false);
  const [installedWorkbenchPackages, setInstalledWorkbenchPackages] = useState<
    Set<string>
  >(new Set());
  const [workbenchPackageLoading, setWorkbenchPackageLoading] = useState(false);
  const [workbenchPackageError, setWorkbenchPackageError] = useState<
    string | null
  >(null);
  const [workbenchPackageMutating, setWorkbenchPackageMutating] = useState<
    Set<string>
  >(new Set());
  const [runtimeWorkbenchStatuses, setRuntimeWorkbenchStatuses] = useState<
    Map<string, RuntimePluginStatus>
  >(new Map());
  const [workbenchPackageStatuses, setWorkbenchPackageStatuses] = useState<
    Map<string, RuntimePluginStatus>
  >(new Map());
  const [uninstallWorkbenchApp, setUninstallWorkbenchApp] =
    useState<WorkbenchBuiltinApp | null>(null);
  const [restoreWorkbenchApp, setRestoreWorkbenchApp] =
    useState<WorkbenchBuiltinApp | null>(null);
  const [uninstallDataPolicy, setUninstallDataPolicy] = useState<
    "keep" | "trash"
  >("keep");
  const canManageWorkbenches = useCanManageWorkbenches();

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setAgentsLoadError(false);
    try {
      await waitForBackendAvailability();
      const localAgents = await listLocalAgents();
      setAgents(localAgents.map(localAgentToWorldAgent));
    } catch (e) {
      swallow(e);
      // Preserve the last good scene roster during a later refresh failure.
      // This keeps the HUB usable while the backend reconnects.
      setAgentsLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const refreshWorkbenchPackages = useCallback(async () => {
    setWorkbenchPackageLoading(true);
    try {
      const { installed, runtimeStatuses } =
        await loadWorkbenchAvailabilitySnapshot();
      const installedSet = new Set(installed.plugins);
      setInstalledWorkbenchPackages(installedSet);
      setWorkbenchPackageStatuses(
        new Map(Object.entries(installed.plugin_states ?? {})),
      );
      setRuntimeWorkbenchStatuses(new Map(runtimeStatuses));
      await syncWorkbenchAvailability({ installed, runtimeStatuses });
      setWorkbenchPackageError(null);
    } catch (error) {
      swallow(error);
      setWorkbenchPackageError(serviceErrorMessage(error));
    } finally {
      setWorkbenchPackageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeMarket === "applications") void refreshWorkbenchPackages();
  }, [activeMarket, refreshWorkbenchPackages]);

  const mutateWorkbenchPackage = useCallback(
    async (
      app: WorkbenchBuiltinApp,
      operation: "install" | "uninstall" | "enable" | "disable" | "rollback",
      options: {
        dataPolicy?: "keep" | "trash";
        restoreData?: boolean;
        recoveryId?: string;
      } = {},
    ) => {
      if (!app.cloudId || !app.packageId) return;
      setWorkbenchPackageMutating((current) =>
        new Set(current).add(app.packageId as string),
      );
      try {
        if (operation === "install") {
          const wasInstalled = installedWorkbenchPackages.has(app.packageId);
          const result = await installCloudPlugin(app.cloudId, {
            restoreData: options.restoreData,
            recoveryId: options.recoveryId,
          });
          setInstalledWorkbenchPackages((current) =>
            new Set(current).add(app.packageId as string),
          );
          if (app.runtimePlugin) {
            const next = await fetchRuntimePluginStatus(app.runtimePlugin);
            setRuntimeWorkbenchStatuses((current) => {
              const updated = new Map(current);
              updated.set(app.runtimePlugin as string, next);
              return updated;
            });
          }
          setModuleAvailable(app.moduleId, true);
          if (!wasInstalled)
            setModuleEnabled(app.moduleId, true, activeAgentId);
          setRestoreWorkbenchApp(null);
          toast.success(
            result.data?.status === "restored"
              ? hub.apps.installedRestored(app.name)
              : result.operation === "update"
                ? hub.apps.updated(app.name)
                : hub.apps.installed(app.name),
          );
        } else if (operation === "uninstall") {
          const result = await uninstallCloudPlugin(app.cloudId, {
            dataPolicy: options.dataPolicy,
            confirmDataMove: options.dataPolicy === "trash",
          });
          setInstalledWorkbenchPackages((current) => {
            const next = new Set(current);
            next.delete(app.packageId as string);
            return next;
          });
          setModuleAvailable(app.moduleId, false);
          if (app.runtimePlugin) {
            setRuntimeWorkbenchStatuses((current) => {
              const updated = new Map(current);
              updated.delete(app.runtimePlugin as string);
              return updated;
            });
          }
          setUninstallWorkbenchApp(null);
          toast.success(
            result.data?.status === "trashed"
              ? hub.apps.uninstalledTrashed(app.name)
              : hub.apps.uninstalledKept(app.name),
          );
        } else if (operation === "rollback") {
          const packageStatus = workbenchPackageStatuses.get(app.packageId);
          const result = await rollbackCloudPlugin(
            app.cloudId,
            packageStatus?.transaction_id ?? undefined,
          );
          if (!result.installed) {
            setInstalledWorkbenchPackages((current) => {
              const next = new Set(current);
              next.delete(app.packageId as string);
              return next;
            });
            setModuleAvailable(app.moduleId, false);
          }
          toast.success(
            result.operation === "restored_previous"
              ? hub.apps.rolledBack(app.name)
              : hub.apps.installUndone(app.name),
          );
        } else {
          const enabled = operation === "enable";
          const next = await setCloudPluginEnabled(app.cloudId, enabled);
          setWorkbenchPackageStatuses((current) => {
            const updated = new Map(current);
            updated.set(app.packageId as string, next);
            return updated;
          });
          if (app.runtimePlugin) {
            setRuntimeWorkbenchStatuses((current) => {
              const updated = new Map(current);
              updated.set(app.runtimePlugin as string, next);
              return updated;
            });
          }
          setModuleAvailable(app.moduleId, enabled);
          if (enabled) setModuleEnabled(app.moduleId, true, activeAgentId);
          toast.success(
            enabled ? hub.apps.enabled(app.name) : hub.apps.disabled(app.name),
          );
        }
        await refreshWorkbenchPackages();
      } catch (error) {
        toast.error(workbenchActionErrorMessage(error));
      } finally {
        setWorkbenchPackageMutating((current) => {
          const next = new Set(current);
          next.delete(app.packageId as string);
          return next;
        });
      }
    },
    [
      activeAgentId,
      hub.apps,
      installedWorkbenchPackages,
      refreshWorkbenchPackages,
      workbenchPackageStatuses,
    ],
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextRoute = resolveHubMarketRoute(location.search);
    setActiveMarket(nextRoute.section);
    if (
      ["opencode", "opencode-zen", "opencode-go"].includes(
        params.get("connect") || "",
      )
    ) {
      setActiveMarket("applications");
      setSearchQuery("OpenCode");
    }
  }, [location.search]);

  // Filter agents
  const allDedupedAgents = useMemo(() => {
    // Hub shows Echo's own user-facing roles only.
    const visibleAgents = agents.filter(
      (agent) =>
        !HIDDEN_LOCAL_AGENT_IDS.has(agent.id) &&
        !/^(?:local_|registry_local_)/.test(agent.name),
    );
    const deduped = dedupeAgentWorldAgents(visibleAgents);
    return LOCAL_LIBRARY_INSTALLED_ONLY
      ? deduped.filter((a) => a.is_installed)
      : deduped;
  }, [agents]);

  // Only fixed primary personas own a HUD and a standalone conversation.
  // Every other role is an on-demand collaborator and belongs in the cloud
  // directory, regardless of whether it has already been downloaded.
  const dedupedAgents = useMemo(
    () =>
      allDedupedAgents.filter((agent) => isPrimaryPersonaAgentId(agent.name)),
    [allDedupedAgents],
  );
  useEffect(() => {
    if (!hudOnly || dedupedAgents.length === 0) return;
    // `?agent=` targets the HUD at one role (the per-row HUD buttons in the
    // bottom-left switcher). It wins over the stored active agent, and it
    // re-selects on change so clicking another row's HUD button switches the
    // panel instead of sticking on the first selection.
    if (requestedAgentName) {
      const requested = resolveHudAgent(
        agents,
        dedupedAgents,
        requestedAgentName,
      );
      if (requested) {
        setSelectedAgent((prev) =>
          prev?.name === requested.name ? prev : requested,
        );
      }
      // An unresolvable target (e.g. a CLI partner, which the HUD roster
      // excludes) opens nothing rather than an unrelated role.
      return;
    }
    if (selectedAgent) return;
    let activeName = "";
    try {
      activeName = window.localStorage.getItem(ACTIVE_AGENT_KEY) ?? "";
    } catch (e) {
      swallow(e, "storage");
    }
    const nextAgent =
      dedupedAgents.find((agent) => agent.name === activeName) ??
      dedupedAgents[0] ??
      null;
    setSelectedAgent(nextAgent);
  }, [agents, dedupedAgents, hudOnly, requestedAgentName, selectedAgent]);

  const handleSelectAgent = useCallback((agent: AgentWorldAgent) => {
    setSelectedAgent(agent);
  }, []);
  const handleSwitchAgent = useCallback((agent: AgentWorldAgent) => {
    setSelectedAgent(agent);
    if (isPrimaryPersonaAgentId(agent.name)) {
      emitAgentChanged(agent.name);
    }
  }, []);

  const handleInstallChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agents"] });
    void fetchAgents();
  }, [fetchAgents, queryClient]);

  const chatRouteForAgent = useCallback((agent: AgentWorldAgent | null) => {
    return taskWorkspaceRoute({ agentId: agent?.name });
  }, []);

  const navigateToHubSection = useCallback(
    (section: HubMarketSection) => {
      const params = new URLSearchParams(location.search);
      params.delete("tab");
      params.delete("talent");
      params.delete("installed");
      params.delete("view");
      if (section === "agents") params.set("tab", "agents");
      if (section === "applications") {
        params.set("tab", "plugins");
        params.set("view", "featured");
      }
      if (section === "skills") params.set("tab", "skills");
      const query = params.toString();
      void navigate(`/workspace/agents${query ? `?${query}` : ""}`, {
        replace: true,
      });
    },
    [location.search, navigate],
  );

  const navigateToApplicationView = useCallback(
    (view: "featured" | "all" | "installed" | "remote") => {
      const params = new URLSearchParams(location.search);
      params.set("tab", "plugins");
      params.set("view", view);
      params.delete("connect");
      const query = params.toString();
      void navigate(`/workspace/agents${query ? `?${query}` : ""}`, {
        replace: true,
      });
    },
    [location.search, navigate],
  );

  const searchPlaceholder =
    activeMarket === "agents"
      ? hub.search.agents
      : activeMarket === "skills"
        ? hub.search.skills
        : hub.search.applications;

  return (
    <div className="relative flex size-full flex-col px-2 pb-2 pt-[calc(0.5rem+var(--window-titlebar-reserve,0px))] md:px-3">
      {!hudOnly ? (
        <div className="-mx-2 -mt-2 flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-background/95 px-2 md:hidden">
          <SidebarTrigger
            className="size-9 shrink-0"
            aria-label={t.common.openSidebarMenu}
            title={t.common.openSidebarMenu}
          />
          <h1 className="min-w-0 truncate text-sm font-semibold">
            {t.agentWorldUnified.pageTitle}
          </h1>
        </div>
      ) : null}
      {/* Main Content */}
      {!hudOnly && (
        <div className="relative flex-1 overflow-y-auto px-3 py-4 md:px-5 md:py-5">
          <Tabs
            value={activeMarket}
            onValueChange={(value) =>
              navigateToHubSection(value as HubMarketSection)
            }
          >
            <header
              data-testid="hub-market-navigation"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3"
            >
              <h1 className="sr-only">HUB</h1>
              <div className="relative max-w-full after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-7 after:bg-gradient-to-l after:from-background after:to-transparent md:after:hidden">
                <TabsList
                  variant="line"
                  className="mb-0 w-fit justify-start gap-1 overflow-x-auto pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:pr-0"
                >
                  <TabsTrigger value="agents" className="h-9 px-3 text-ui">
                    {hub.tabs.agents}
                  </TabsTrigger>
                  <TabsTrigger
                    value="applications"
                    className="h-9 px-3 text-ui"
                  >
                    {hub.tabs.applications}
                  </TabsTrigger>
                  <TabsTrigger value="skills" className="h-9 px-3 text-ui">
                    {hub.tabs.skills}
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="relative w-full sm:max-w-[320px]">
                <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  // Autofill guard: a bare text input gets the saved account
                  // auto-filled by the browser, which then filters by it.
                  type="search"
                  name="echo-agents-search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-testid="agents-search-input"
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-lg border-border-default bg-card pl-8 pr-9 text-ui shadow-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label={hub.search.clear}
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </header>

            <TabsContent value="agents" className="mt-0">
              <h2 className="sr-only">{hub.tabs.agents}</h2>
              <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-ui text-muted-foreground"
                  onClick={() => setRemoteAgentsOpen(true)}
                >
                  {hub.agents.connectExternal}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-md border-primary/20 bg-primary/5 px-2.5 text-ui text-primary shadow-none hover:bg-primary/10"
                  onClick={() => setHubSmartTeamOpen(true)}
                >
                  <SparklesIcon className="mr-1.5 size-3.5" />
                  {hub.agents.smartTeam}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 rounded-md px-2.5 text-ui text-muted-foreground shadow-none"
                    >
                      {hub.agents.add}
                      <ChevronDownIcon className="ml-1 size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onSelect={() => navigate(agentCreationRoute())}
                    >
                      <BotIcon className="size-4" />
                      {hub.agents.createMember}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <AgentsTab
                agents={dedupedAgents}
                filteredAgents={dedupedAgents}
                loading={loading}
                loadError={agentsLoadError}
                activeCategory="all"
                onCategoryChange={() => undefined}
                onSelectAgent={handleSelectAgent}
                onInstallChange={handleInstallChange}
                onRetry={() => void fetchAgents()}
                onCreateAgent={() => navigate(agentCreationRoute())}
                showManagementActions={false}
                sceneOnly
              />

              <Dialog
                open={remoteAgentsOpen}
                onOpenChange={setRemoteAgentsOpen}
              >
                <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>{hub.agents.externalTitle}</DialogTitle>
                    <DialogDescription>
                      {hub.agents.externalDescription}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="min-h-0 overflow-y-auto">
                    <A2AAgentsPanel className="rounded-xl border border-border-subtle" />
                  </div>
                </DialogContent>
              </Dialog>

              <SmartTeamDialog
                open={hubSmartTeamOpen}
                onOpenChange={setHubSmartTeamOpen}
                agents={dedupedAgents}
                onInstallChange={handleInstallChange}
              />

              <section
                aria-labelledby="remote-role-directory-title"
                className="mt-5 border-t border-border-subtle pt-4"
              >
                <div className="mb-3">
                  <h3
                    id="remote-role-directory-title"
                    className="text-sm font-semibold text-foreground"
                  >
                    {hub.agents.directory}
                  </h3>
                </div>
                <WorkBuddyCloudStorePanel
                  digitalEmployeesOnly
                  embedded
                  showTypeFilter={false}
                  showTeamFilter
                  searchQuery={searchQuery}
                  onInstalled={() => handleInstallChange()}
                />
              </section>
            </TabsContent>

            <TabsContent value="applications" className="mt-0 space-y-4">
              <section aria-labelledby="application-library-title">
                <h2 id="application-library-title" className="sr-only">
                  {hub.apps.center}
                </h2>
                <div className="mb-6">
                  <h3 className="mb-2 text-sm font-semibold">
                    {hub.apps.heading}
                  </h3>
                  {workbenchPackageError ? (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-ui text-muted-foreground"
                    >
                      {hub.apps.statusUnread(workbenchPackageError)}
                      <Button
                        size="sm"
                        variant="link"
                        disabled={workbenchPackageLoading}
                        onClick={() => void refreshWorkbenchPackages()}
                      >
                        {hub.apps.retry}
                      </Button>
                    </div>
                  ) : null}
                  {matchingApps.length === 0 && (
                    <p className="py-4 text-sm text-muted-foreground">
                      {hub.apps.noMatch(searchQuery)}
                      <button
                        type="button"
                        className="ml-2 text-primary underline"
                        onClick={() => setSearchQuery("")}
                      >
                        {hub.apps.clearSearch}
                      </button>
                    </p>
                  )}
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {matchingApps.map((app) => {
                      const Icon = WORKBENCH_APP_ICONS[app.icon];
                      const isInSidebar = enabledModuleIdSet.has(app.moduleId);
                      const isCore = app.delivery === "core";
                      const packageStatus = app.packageId
                        ? workbenchPackageStatuses.get(app.packageId)
                        : undefined;
                      const isInstalled =
                        isCore ||
                        (packageStatus
                          ? packageStatus.installed
                          : app.packageId
                            ? installedWorkbenchPackages.has(app.packageId)
                            : false);
                      const isMutating = app.packageId
                        ? workbenchPackageMutating.has(app.packageId)
                        : false;
                      const runtimeStatus = app.runtimePlugin
                        ? runtimeWorkbenchStatuses.get(app.runtimePlugin)
                        : undefined;
                      const lifecycleState =
                        packageStatus?.lifecycle_state ??
                        runtimeStatus?.lifecycle_state;
                      const isBroken =
                        lifecycleState === "broken" ||
                        runtimeStatus?.lifecycle_state === "broken";
                      const isIncompatible =
                        lifecycleState === "incompatible" ||
                        runtimeStatus?.lifecycle_state === "incompatible";
                      const isUpdateAvailable =
                        lifecycleState === "update_available";
                      const isRuntimeEnabled = Boolean(
                        isInstalled &&
                        !isBroken &&
                        !isIncompatible &&
                        (packageStatus?.enabled ?? true) &&
                        (runtimeStatus?.enabled ?? true),
                      );
                      const recoveries = packageStatus?.recoveries ?? [];
                      const requestInstall = () => {
                        if (!isInstalled && recoveries.length > 0) {
                          setRestoreWorkbenchApp(app);
                          return;
                        }
                        void mutateWorkbenchPackage(app, "install");
                      };
                      return (
                        <div
                          key={app.id}
                          className="group relative border-b border-border-subtle transition-colors hover:bg-muted/25"
                        >
                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => {
                              // Without the admin role the app's own page
                              // explains its state; nothing to install here.
                              if (
                                workbenchPackageError ||
                                !canManageWorkbenches
                              ) {
                                void navigate(app.workspaceRoute);
                              } else if (isInstalled && isRuntimeEnabled) {
                                void navigate(app.workspaceRoute);
                              } else if (
                                isInstalled &&
                                !isBroken &&
                                !isIncompatible
                              ) {
                                void mutateWorkbenchPackage(app, "enable");
                              } else {
                                requestInstall();
                              }
                            }}
                            className="flex min-h-16 w-full items-center gap-3 px-2 py-2 pr-20 text-left disabled:cursor-wait"
                            aria-label={`${app.name} · ${app.description}`}
                          >
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-foreground ring-1 ring-inset ring-border transition-transform duration-200 group-hover:scale-[1.04]">
                              <Icon className="size-[18px] stroke-[1.8]" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-foreground">
                                {app.name}
                              </span>
                              <span className="mt-0.5 block truncate text-ui text-muted-foreground">
                                {app.description}
                              </span>
                              <WorkbenchStatusLine
                                canManage={canManageWorkbenches}
                                isBroken={isBroken}
                                isIncompatible={isIncompatible}
                                isUpdateAvailable={isUpdateAvailable}
                                isDisabled={isInstalled && !isRuntimeEnabled}
                                hasRecoveries={
                                  !isInstalled && recoveries.length > 0
                                }
                              />
                            </span>
                          </button>
                          {isCore ? (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 px-2 text-micro font-medium text-muted-foreground">
                              {hub.apps.builtIn}
                            </span>
                          ) : isInstalled ? (
                            <WorkbenchManageMenu
                              appName={app.name}
                              canManage={canManageWorkbenches}
                              isInSidebar={isInSidebar}
                              isRuntimeEnabled={isRuntimeEnabled}
                              isUpdateAvailable={isUpdateAvailable}
                              needsRepair={isBroken || isIncompatible}
                              rollbackOperation={
                                packageStatus?.rollback_available
                                  ? (packageStatus.rollback_operation ??
                                    "install")
                                  : null
                              }
                              onToggleSidebar={() =>
                                setModuleEnabled(
                                  app.moduleId,
                                  !isInSidebar,
                                  activeAgentId,
                                )
                              }
                              onOperation={(operation) =>
                                void mutateWorkbenchPackage(app, operation)
                              }
                              onUninstall={() => {
                                setUninstallDataPolicy("keep");
                                setUninstallWorkbenchApp(app);
                              }}
                            />
                          ) : (
                            <WorkbenchInstallControl
                              appName={app.name}
                              canManage={canManageWorkbenches}
                              isInSidebar={isInSidebar}
                              hasRecoveries={recoveries.length > 0}
                              isMutating={isMutating}
                              disabled={
                                isMutating ||
                                workbenchPackageLoading ||
                                Boolean(workbenchPackageError)
                              }
                              statusUnread={Boolean(workbenchPackageError)}
                              onRemoveFromSidebar={() =>
                                setModuleEnabled(
                                  app.moduleId,
                                  false,
                                  activeAgentId,
                                )
                              }
                              onInstall={requestInstall}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <OnDemandStoreSections />
                <div>
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">
                        {pluginDirectoryView === "featured"
                          ? hub.plugins.featuredHeading
                          : hub.plugins.allHeading}
                      </h3>
                      <p className="mt-1 text-ui text-muted-foreground">
                        {pluginDirectoryView === "featured"
                          ? hub.plugins.featuredHint
                          : hub.plugins.allHint}
                      </p>
                    </div>
                    <div
                      role="tablist"
                      aria-label={hub.plugins.viewLabel}
                      className="flex w-fit items-center rounded-lg bg-muted/60 p-1"
                    >
                      {(
                        [
                          ["featured", hub.plugins.featured],
                          ["all", hub.plugins.all],
                          ["installed", hub.plugins.installed],
                        ] as const
                      ).map(([view, label]) => (
                        <button
                          key={view}
                          type="button"
                          role="tab"
                          aria-selected={marketRoute.applicationView === view}
                          onClick={() => navigateToApplicationView(view)}
                          className={cn(
                            "h-7 rounded-md px-3 text-ui transition-colors",
                            marketRoute.applicationView === view
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
                    view={pluginDirectoryView}
                    featuredIds={DEFAULT_FEATURED_APP_IDS}
                    maxItems={
                      pluginDirectoryView === "featured" ? 7 : undefined
                    }
                    showToolbar={false}
                    compact
                  />
                </div>
              </section>
            </TabsContent>

            <TabsContent value="skills" className="mt-0">
              <section aria-labelledby="skills-library-title">
                <h2 id="skills-library-title" className="sr-only">
                  {hub.tabs.skills}
                </h2>
                <CloudSkillsPanel
                  searchQuery={searchQuery}
                  onClearSearch={() => setSearchQuery("")}
                />
              </section>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {selectedAgent ? (
        <Suspense fallback={null}>
          <AgentRoleProfileDialog
            agent={selectedAgent}
            agents={
              hudOnly
                ? dedupedAgents.filter((candidate) =>
                    isPrimaryPersonaAgentId(candidate.name),
                  )
                : dedupedAgents
            }
            open
            onInstallChange={handleInstallChange}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) {
                const returnRoute = hudOnly
                  ? chatRouteForAgent(selectedAgent)
                  : "";
                setSelectedAgent(null);
                if (hudOnly) void navigate(returnRoute);
              }
            }}
            onSelectAgent={handleSwitchAgent}
            onCreateAgent={() =>
              navigate(agentCreationRoute({ returnTo: "hud" }))
            }
          />
        </Suspense>
      ) : null}

      <RestoreWorkbenchDialog
        appName={restoreWorkbenchApp?.name ?? ""}
        open={Boolean(restoreWorkbenchApp)}
        onClose={() => setRestoreWorkbenchApp(null)}
        onFreshInstall={() => {
          if (restoreWorkbenchApp)
            void mutateWorkbenchPackage(restoreWorkbenchApp, "install");
        }}
        onRestore={() => {
          if (!restoreWorkbenchApp?.packageId) return;
          const recovery = workbenchPackageStatuses.get(
            restoreWorkbenchApp.packageId,
          )?.recoveries?.[0];
          void mutateWorkbenchPackage(restoreWorkbenchApp, "install", {
            restoreData: true,
            recoveryId: recovery?.recovery_id,
          });
        }}
      />
      <UninstallWorkbenchDialog
        appName={uninstallWorkbenchApp?.name ?? ""}
        open={Boolean(uninstallWorkbenchApp)}
        policy={uninstallDataPolicy}
        busy={
          !uninstallWorkbenchApp ||
          Boolean(
            uninstallWorkbenchApp.packageId &&
            workbenchPackageMutating.has(uninstallWorkbenchApp.packageId),
          )
        }
        onPolicyChange={setUninstallDataPolicy}
        onClose={() => setUninstallWorkbenchApp(null)}
        onConfirm={() => {
          if (!uninstallWorkbenchApp) return;
          void mutateWorkbenchPackage(uninstallWorkbenchApp, "uninstall", {
            dataPolicy: uninstallDataPolicy,
          });
        }}
      />
    </div>
  );
}
