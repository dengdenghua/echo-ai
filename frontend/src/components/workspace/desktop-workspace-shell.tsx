import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  CableIcon,
  DatabaseIcon,
  GlobeIcon,
  MessageSquareIcon,
  PuzzleIcon,
  SparklesIcon,
  WorkflowIcon,
  ActivityIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SearchIcon,
  StoreIcon,
  XIcon,
} from "lucide-react";
import {
  BrowserStoreProvider,
  setAppMode,
} from "@/components/browser/browser-store";
import { useElectronTitleBar } from "@/components/electron-title-bar";
import { DESKTOP_TITLE_BAR_HEIGHT } from "@/core/workspace/window-chrome";
import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import { currentActorScope } from "@/core/auth/api";
import { useActiveAgentId } from "@/core/agents/active";
import {
  MODULE_CATALOG,
  MODULE_GROUP_LABEL_KEYS,
  MODULE_GROUP_ORDER,
} from "@/core/modules/catalog";
import {
  isInstallableModule,
  useEnabledModuleIds,
  useModuleAvailabilityKnown,
} from "@/core/modules/enabled-modules";
import { moduleMatchesLocation } from "@/core/modules/module-routing";
import {
  useWorkspaceWebShortcuts,
  workspaceWebAppRoute,
} from "@/core/workbench/apps";
import { useWorkbenchAvailabilitySync } from "@/core/workbench/availability";
import { BROWSER_WORKSPACE_ROUTE } from "@/core/workspace/sidebar-routing";
import {
  readDesktopSidebarOpen,
  saveDesktopSidebarOpen,
} from "@/core/workspace/desktop-sidebar-preference";
import {
  DESKTOP_PIN_KEY,
  DEFAULT_DESKTOP_PINS,
  desktopCopy,
  parseDesktopPins,
  toggleDesktopPin,
} from "@/core/workspace/desktop-navigation";
import { stringAt } from "@/core/utils/guards";
import { cn } from "@/lib/utils";
import { MODULE_ICONS } from "./module-icons";
import { AppShortcutRow } from "./app-shortcut-row";
import {
  useConversationHomeRoute,
  isMainConversationRoute,
} from "@/core/workspace/knowledge-application";
import { AgentFooter } from "./sidebar-footer";
import { WorkspaceSurfaceSwitch } from "./workspace-surface-switch";
import {
  DesktopShellContext,
  DesktopSidebarState,
  DesktopToolbarTarget,
} from "./desktop-shell-context";

const CommandPalette = lazy(() =>
  import("./command-palette").then((m) => ({ default: m.CommandPalette })),
);
const ModuleEditor = lazy(() =>
  import("./module-editor-dialog").then((m) => ({
    default: m.ModuleEditorDialog,
  })),
);
const WebShortcutEditor = lazy(() =>
  import("./web-shortcut-editor").then((m) => ({
    default: m.WebShortcutEditor,
  })),
);

type AppEntry = {
  id: string;
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  group: string;
  active: boolean;
};

// This route parent stays mounted while its content changes. In particular,
// navigation buttons never belong to either of the two changing surfaces.
export function DesktopWorkspaceShell() {
  const [params] = useSearchParams();
  const embedded = params.get("embedded");
  const actor = currentActorScope();
  if (embedded === "design" || embedded === "app") return <Outlet />;
  return (
    <DesktopShellContext.Provider value={true}>
      <DesktopFrame key={actor} actor={actor} />
    </DesktopShellContext.Provider>
  );
}

function DesktopFrame({ actor }: { actor: string }) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(readDesktopSidebarOpen);
  const updateSidebarOpen = useCallback((open: boolean) => {
    saveDesktopSidebarOpen(open);
    setSidebarOpen(open);
  }, []);
  const { t, locale } = useI18n();
  const copy = desktopCopy(locale);
  const { pathname, search } = useLocation();
  const conversationReturn = useConversationHomeRoute();
  const conversationNavigation = isMainConversationRoute(pathname);
  const {
    contentTopInset,
    controlsSafeInset,
    controlsSide,
    integratedToolbar,
  } = useElectronTitleBar();
  const activeAgent = useActiveAgentId() ?? "general";
  const enabled = useEnabledModuleIds(activeAgent);
  const availabilityKnown = useModuleAvailabilityKnown();
  useWorkbenchAvailabilitySync();
  const web = useWorkspaceWebShortcuts();
  const pinKey = `${DESKTOP_PIN_KEY}:${actor}`;
  const [pins, setPins] = useState(() => {
    try {
      return parseDesktopPins(localStorage.getItem(pinKey));
    } catch {
      return parseDesktopPins(null);
    }
  });
  const [more, setMore] = useState(false);
  const [manage, setManage] = useState(false);
  const [add, setAdd] = useState(false);
  const browser = pathname === BROWSER_WORKSPACE_ROUTE;
  useEffect(() => {
    try {
      setAppMode(browser ? "browser" : "workspace");
    } catch {
      /* Storage may be restricted. */
    }
  }, [browser]);
  useLayoutEffect(() => {
    // Close before the new surface paints, never after its first interaction.
    setMore(false);
  }, [pathname, search]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === pinKey) setPins(parseDesktopPins(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [pinKey]);
  const entries = useMemo<AppEntry[]>(
    () => [
      { id: "chat", to: conversationReturn, label: locale.startsWith("zh") ? "对话" : "Chats",
        icon: MessageSquareIcon, group: "workspace", active: isMainConversationRoute(pathname) },
      ...MODULE_CATALOG.filter(
        (m) =>
          enabled.includes(m.id) &&
          (availabilityKnown || !isInstallableModule(m.id)),
      ).map((m) => ({
        id: m.id,
        to: m.to,
        label: stringAt(t.sidebar, m.labelKey) ?? m.labelKey,
        icon: MODULE_ICONS[m.id] ?? StoreIcon,
        group: m.group,
        active: m.id === "assistant"
          ? pathname.startsWith("/workspace/realtime/echo-assistant") && new URLSearchParams(search).get("agent") === "echo"
          : moduleMatchesLocation(m, pathname, search),
      })),
      ...[
        { id: "local-knowledge", to: "/workspace/storage", zh: "本地知识库", en: "Local knowledge", icon: DatabaseIcon },
        { id: "skills", to: "/workspace/skills", zh: "技能", en: "Skills", icon: SparklesIcon },
        { id: "plugins", to: "/workspace/plugins", zh: "插件", en: "Plugins", icon: PuzzleIcon },
        { id: "workflows", to: "/workspace/workflows", zh: "工作流", en: "Workflows", icon: WorkflowIcon },
        { id: "observability", to: "/workspace/observability", zh: "任务与运行记录", en: "Activity", icon: ActivityIcon },
      ].map(({ zh, en, ...entry }) => ({
        ...entry,
        label: locale.startsWith("zh") ? zh : en,
        group: "tools",
        active: pathname === entry.to && (entry.id !== "local-knowledge" || !new URLSearchParams(search).has("library")),
      })),
      ...web.map((w) => ({
        id: w.id,
        to: workspaceWebAppRoute(w),
        label: w.name,
        icon: GlobeIcon,
        group: "web",
        active:
          pathname === "/workspace/web-app" &&
          new URLSearchParams(search).get("url") === w.url,
      })),
    ],
    [availabilityKnown, enabled, pathname, search, t.sidebar, web, locale, conversationReturn],
  );
  const devices: AppEntry = {
    id: "devices", to: "/workspace/devices", label: copy.devices,
    icon: CableIcon, group: "core", active: pathname.startsWith("/workspace/devices"),
  };
  const pinned = pins.flatMap((id) => entries.find((e) => e.id === id) ?? []);
  const savePins = (next: string[]) => {
    setPins(next);
    try {
      localStorage.setItem(pinKey, JSON.stringify(next));
    } catch {
      /* Private mode still supports this session. */
    }
  };
  const togglePin = (id: string) => savePins(toggleDesktopPin(pins, id));
  const railLink = (entry: AppEntry) => (
    <Tooltip key={entry.id}>
      <TooltipTrigger asChild>
        <Link
          to={entry.to}
          className="desktop-rail-button"
          data-desktop-app={entry.id}
          aria-label={entry.label}
          aria-current={entry.active ? "page" : undefined}
        >
          <entry.icon className="size-5" strokeWidth={1.7} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  );
  return (
    <DesktopSidebarState.Provider
      value={{ open: sidebarOpen, setOpen: updateSidebarOpen }}
    >
      <BrowserStoreProvider>
        <TooltipProvider delayDuration={250}>
          <div
            className="desktop-workspace-shell"
            data-testid="desktop-workspace-shell"
            style={{ paddingTop: contentTopInset }}
          >
            <header
              className="desktop-toolbar"
              aria-label="Echo AI"
              data-surface={browser ? "browser" : "agent"}
              data-window-toolbar={integratedToolbar ? controlsSide : undefined}
              style={
                integratedToolbar
                  ? {
                      height: DESKTOP_TITLE_BAR_HEIGHT,
                      minHeight: DESKTOP_TITLE_BAR_HEIGHT,
                      paddingLeft:
                        controlsSide === "left"
                          ? `calc(12px + ${controlsSafeInset})`
                          : undefined,
                      paddingRight:
                        controlsSide === "right"
                          ? `calc(12px + ${controlsSafeInset})`
                          : undefined,
                    }
                  : undefined
              }
            >
              <WorkspaceSurfaceSwitch active={browser ? "browser" : "agent"} />
              <div
                className="desktop-toolbar-slot"
                ref={setToolbarTarget}
                hidden={!browser}
              />
              {conversationNavigation && !sidebarOpen && (
                <button
                  type="button"
                  className="desktop-sidebar-reopen"
                  aria-label={t.sidebar.expandSidebar}
                  title={t.sidebar.expandSidebar}
                  aria-expanded={false}
                  onClick={() => updateSidebarOpen(true)}
                >
                  <PanelLeftOpenIcon className="size-4" />
                </button>
              )}
              <button
                className={cn(
                  "desktop-mobile-menu",
                  !conversationNavigation && "invisible",
                )}
                aria-label={copy.navigation}
                onClick={() =>
                  window.dispatchEvent(new Event("echo:desktop-sidebar"))
                }
              >
                <MenuIcon className="size-[18px]" />
              </button>
              <button
                className="desktop-search"
                onClick={() =>
                  window.dispatchEvent(new Event("echo:command-palette"))
                }
                aria-label={copy.search}
              >
                <SearchIcon className="size-3.5" />
                <span>{copy.search}</span>
                <kbd>Ctrl K</kbd>
              </button>
            </header>
            <div className="desktop-body">
              <nav className="desktop-app-rail" aria-label={copy.apps}>
                <div className="desktop-rail-pins">{pinned.map(railLink)}</div>
                <DialogPrimitive.Root
                  open={more}
                  onOpenChange={(open) => {
                    setMore(open);
                  }}
                  modal={false}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DialogPrimitive.Trigger asChild>
                        <button
                          className="desktop-rail-button"
                          aria-label={copy.more}
                          data-desktop-app="more"
                        >
                          <MoreHorizontalIcon className="size-5" />
                        </button>
                      </DialogPrimitive.Trigger>
                    </TooltipTrigger>
                    <TooltipContent side="right">{copy.more}</TooltipContent>
                  </Tooltip>
                  <DialogPrimitive.Portal>
                    <DialogPrimitive.Content
                      className="desktop-more-panel"
                      style={{
                        top: `calc(${contentTopInset} + 64px)`,
                        maxHeight: `calc(100svh - ${contentTopInset} - 80px)`,
                      }}
                      aria-describedby="desktop-more-hint"
                    >
                      <div className="desktop-more-heading">
                        <DialogPrimitive.Title>
                          {copy.more}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Close
                          aria-label={copy.close}
                          className="desktop-more-close"
                        >
                          <XIcon className="size-4" />
                        </DialogPrimitive.Close>
                      </div>
                      <DialogPrimitive.Description
                        id="desktop-more-hint"
                        className="sr-only"
                      >
                        {copy.pinHint}
                      </DialogPrimitive.Description>
                      <div className="desktop-more-scroll">
                        {[...MODULE_GROUP_ORDER, "tools" as const, "web" as const].map(
                          (group) => {
                            const items = entries.filter(
                              (e) => e.group === group,
                            );
                            if (!items.length) return null;
                            const title =
                              group === "tools"
                                ? (locale.startsWith("zh") ? "工具与扩展" : "Tools & extensions")
                                : group === "web"
                                ? copy.web
                                : (stringAt(
                                    t.sidebar,
                                    MODULE_GROUP_LABEL_KEYS[group],
                                  ) ?? group);
                            return (
                              <section key={group}>
                                <h3>{title}</h3>
                                <div className="desktop-app-grid">
                                  {items.map((entry) => (
                                    <AppShortcutRow
                                      key={entry.id}
                                      {...entry}
                                      pinned={pins.includes(entry.id)}
                                      pinLabel={copy.pin}
                                      unpinLabel={copy.unpin}
                                      pinDisabledReason={copy.pinHint}
                                      onTogglePin={() => togglePin(entry.id)}
                                      onOpen={() => setMore(false)}
                                    />
                                  ))}
                                </div>
                              </section>
                            );
                          },
                        )}
                      </div>
                      <div className="px-3 pb-2">
                        <button type="button" className="desktop-text-button"
                          onClick={() => savePins([...new Set([...DEFAULT_DESKTOP_PINS, ...pins])])}>
                          {locale.startsWith("zh") ? "添加推荐常驻入口" : "Add recommended shortcuts"}
                        </button>
                      </div>
                      <div className="desktop-more-footer">
                        <button
                          onClick={() => {
                            setMore(false);
                            setAdd(true);
                          }}
                        >
                          <PlusIcon className="size-4" />
                          {copy.add}
                        </button>
                        <button
                          className="desktop-text-button"
                          onClick={() => {
                            setMore(false);
                            setManage(true);
                          }}
                        >
                          {copy.manage}
                        </button>
                      </div>
                    </DialogPrimitive.Content>
                  </DialogPrimitive.Portal>
                </DialogPrimitive.Root>
                <div className="desktop-rail-bottom">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="desktop-rail-button desktop-rail-search"
                        aria-label={`${copy.search} · Ctrl K`}
                        onClick={() =>
                          window.dispatchEvent(
                            new Event("echo:command-palette"),
                          )
                        }
                      >
                        <SearchIcon className="size-[18px]" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {copy.search} · Ctrl K
                    </TooltipContent>
                  </Tooltip>
                  {railLink(devices)}
                  <AgentFooter variant="rail" />
                </div>
              </nav>
              <div className="desktop-surface">
                <Suspense
                  fallback={
                    <BrandLoadingPanel
                      label={t.common.loading}
                      className="h-full"
                    />
                  }
                >
                  <DesktopToolbarTarget.Provider value={toolbarTarget}>
                    <Outlet />
                  </DesktopToolbarTarget.Provider>
                </Suspense>
              </div>
            </div>
            <Suspense fallback={null}>
              <CommandPalette />
              {manage && (
                <ModuleEditor open={manage} onOpenChange={setManage} />
              )}
            </Suspense>
            <Dialog open={add} onOpenChange={setAdd}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{copy.add}</DialogTitle>
                  <DialogDescription>{copy.web}</DialogDescription>
                </DialogHeader>
                <Suspense fallback={<span>{t.common.loading}</span>}>
                  <WebShortcutEditor />
                </Suspense>
              </DialogContent>
            </Dialog>
          </div>
        </TooltipProvider>
      </BrowserStoreProvider>
    </DesktopSidebarState.Provider>
  );
}
