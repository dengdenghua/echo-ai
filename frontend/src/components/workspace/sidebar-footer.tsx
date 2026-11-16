import { AgentAvatar } from "./agent-avatar";
export { AgentAvatar } from "./agent-avatar";
import {
  AlertCircleIcon,
  CoinsIcon,
  LoaderCircleIcon,
  LockIcon,
  LogOutIcon,
  RefreshCwIcon,
  SettingsIcon,
  StarIcon,
  UserCircleIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { swallow } from "@/core/utils/log";
import { ACTIVE_AGENT_KEY, ROUTE_LOCKS } from "@/core/agents/active";
import { eventBus, emitAgentChanged, emitOpenSettings } from "@/core/events";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgents, type Agent } from "@/core/agents";
import { primaryPersonaRoster } from "@/core/agents/agent-list";
import {
  DEFAULT_PRIMARY_AGENT_ID,
  isPrimaryPersonaAgentId,
} from "@/core/agents/persona-policy";
import { useI18n } from "@/core/i18n/hooks";
import { ORG_COPY } from "@/core/organizations/copy";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { agentHudHref } from "@/core/workspace/sidebar-routing";
import { useOctLink } from "@/core/oct/hooks";
import { useAuth } from "@/providers/AuthProvider";
import { canAccessOperatorControlPlane } from "@/core/auth/control-plane-access";
import { CreditsCenterDialog } from "@/components/workspace/credits-center";
import { cn } from "@/lib/utils";
import { useEvolutionOverview } from "@/core/evolution/hooks";
import {
  calculateLevel,
  calculateStars,
} from "@/components/workspace/evolution-dashboard/game-data-transformer";

// ─── Helpers ─────────────────────────────────────────────────────

function readActiveAgentName(): string | null {
  try {
    const stored = window.localStorage.getItem(ACTIVE_AGENT_KEY)?.trim() || "";
    if (!stored || isPrimaryPersonaAgentId(stored)) return stored || null;
    window.localStorage.setItem(ACTIVE_AGENT_KEY, DEFAULT_PRIMARY_AGENT_ID);
    return DEFAULT_PRIMARY_AGENT_ID;
  } catch (e) {
    swallow(e);
    return null;
  }
}

function isPlaceholderUsername(username?: string | null): boolean {
  const value = username?.trim().toLowerCase();
  return !value || value === "anonymous" || value === "__anonymous__";
}

function getAccountDisplayName(user: {
  mobile?: string;
  email?: string;
  username?: string;
  actor_id?: string;
}): string {
  return (
    user.mobile ||
    user.email ||
    (!isPlaceholderUsername(user.username) ? user.username : "") ||
    user.actor_id ||
    ""
  );
}

// ─── AgentFooter ─────────────────────────────────────────────────

export function AgentFooter({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "rail";
}) {
  const compact = variant === "rail";
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const {
    agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    error: agentsError,
    refetch: refetchAgents,
  } = useAgents();
  const { user, logout, authStatus } = useAuth();
  const _navigate = useNavigate();
  const { pathname, search } = useLocation();
  const octLink = useOctLink();
  const { t, locale } = useI18n();
  const credits = octLink.data?.credits?.surplusCredits;
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [activeName, setActiveName] = useState<string | null>(() =>
    readActiveAgentName(),
  );

  // Fetch evolution data for the active agent (no agent filter, gets current user's data)
  const { data: evolutionData } = useEvolutionOverview({
    enabled: canAccessOperatorControlPlane(authStatus, user),
  });
  useEffect(() => {
    return eventBus.on("agent:changed", ({ name, source }) => {
      if (isPrimaryPersonaAgentId(name)) {
        setActiveName(name);
      } else if (source !== "thread") {
        setActiveName(DEFAULT_PRIMARY_AGENT_ID);
      }
    });
  }, []);
  // 兜底：监听 localStorage 变化（多标签页同步 + 页面初始化时序补偿）。
  // emitAgentChanged 已经写 localStorage 并发 eventBus 事件，但 window CustomEvent
  // 和跨 tab storage 事件不经过 eventBus，这里做最后一道同步保障。
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== ACTIVE_AGENT_KEY) return;
      const next = readActiveAgentName();
      setActiveName(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const lock = ROUTE_LOCKS.find((r) => pathname.startsWith(r.prefix));
  const surfaceParam = new URLSearchParams(search).get("surface");
  const urlAgentName = new URLSearchParams(search).get("agent")?.trim() || null;
  const agentLibrarySurface = surfaceParam === "company" ? "company" : "chat";
  const agentLibraryHref = (tab?: string, agentName?: string) =>
    agentHudHref({ surface: agentLibrarySurface, tab, agentName });
  const personaAgents = useMemo(() => primaryPersonaRoster(agents), [agents]);
  // 解析优先级与 page.tsx activeAgentId 保持一致：
  // 1) route lock（如 /workspace/agents/:id/chats 锁定到该 agent）
  // 2) URL ?agent= 参数 — 但 "echo" 是全局助理入口，位于角色选择器
  //    之上，不应改变左下角的角色选择状态，因此忽略它
  // 3) localStorage 里用户最近选择的 agent
  // 4) 兜底 "general"
  const isFreshTaskRoute = /^\/workspace\/realtime\/new(?:\/|$)/.test(pathname);
  const effectiveUrlAgent =
    isFreshTaskRoute && urlAgentName !== "echo" ? urlAgentName : null;
  const effectiveName =
    lock?.agent ?? effectiveUrlAgent ?? activeName ?? "general";

  // The assistant (echo) is a global fixed persona, not a switchable role.
  // It coexists with every other agent but must never surface in the bottom-left
  // persona trigger — even when the current thread belongs to the assistant.
  const switcherAgents = useMemo(() => personaAgents, [personaAgents]);

  const active: Agent | undefined =
    (effectiveName && switcherAgents.find((a) => a.name === effectiveName)) ||
    switcherAgents[0];

  const lockedAgent: Agent | undefined =
    lock && !agents.find((a) => a.name === lock.agent)
      ? {
          name: lock.agent,
          display_name:
            lock.agent === "admin" ? t.sidebar.adminAgentName : lock.agent,
          description: "",
          icon: lock.agent === "admin" ? "🛡️" : undefined,
          avatar_url: `/api/agents/${lock.agent}/avatar`,
          model: null,
          tool_groups: [],
        }
      : undefined;

  const selectAgent = (name: string) => {
    setActiveName(name);
    emitAgentChanged(name);
    if (!pathname.startsWith("/workspace/realtime/")) {
      void _navigate(taskWorkspaceRoute({ agentId: name }));
    }
  };

  // Keep pointer-up inside the profile action too: otherwise Radix synthesizes
  // a click on the parent item after its pointer-down was stopped.
  const renderHudButton = (agent: Agent) => (
    <button
      type="button"
      title={t.sidebar.openAgentHudFor(agent.display_name || agent.name)}
      aria-label={t.sidebar.openAgentHudFor(agent.display_name || agent.name)}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget
            .closest<HTMLElement>('[role="menuitem"]')
            ?.focus();
        }
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setAgentMenuOpen(false);
        void _navigate(agentLibraryHref(undefined, agent.name));
      }}
      className={cn(
        "flex min-h-[36px] min-w-[56px] shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-xs font-normal text-muted-foreground/80 transition-colors",
        "hover:bg-foreground/[0.05] hover:text-foreground",
        "focus-visible:bg-foreground/[0.05] focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 [@media(pointer:coarse)]:min-h-[44px]",
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        <rect x="2" y="3" width="20" height="18" rx="2.5" />
        <circle cx="16.5" cy="8" r="1.5" />
        <path d="M14 12a2.5 2.5 0 0 1 5 0M6 10h3M6 13h4M6 16h7" />
      </svg>
      <span>{t.sidebar.agentProfileAction}</span>
    </button>
  );

  const renderAgentItem = (a: Agent) => {
    const isActive = a.name === active?.name;
    return (
      <DropdownMenuItem
        key={a.name}
        disabled={compact && Boolean(lock)}
        aria-current={isActive ? "true" : undefined}
        onSelect={() => selectAgent(a.name)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>("button")
              ?.focus();
          }
        }}
        className={cn(
          "grid min-h-[44px] grid-cols-[28px_minmax(0,1fr)_56px] items-center gap-2 rounded-lg px-2 py-1 text-xs",
          "transition-colors focus:bg-foreground/[0.035] focus:text-foreground",
          isActive && "bg-foreground/[0.065] focus:bg-foreground/[0.08]",
        )}
      >
        <AgentAvatar agent={a} className="size-[28px] rounded-md text-xs" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium leading-none">
            {a.display_name || a.name}
            {isActive && (
              <span className="sr-only"> · {t.sidebar.currentAgent}</span>
            )}
          </span>
          <span className="truncate text-xs font-normal leading-tight text-muted-foreground">
            {t.sidebar.agentRoleSummary[a.name] ||
              a.description ||
              t.sidebar.soloChat}
          </span>
        </span>
        {renderHudButton(a)}
      </DropdownMenuItem>
    );
  };

  const displayAgent = lockedAgent ?? active;
  const hasPersonaAgents = personaAgents.length > 0;
  const showAgentLoading =
    !hasPersonaAgents && (agentsLoading || agentsFetching);
  const showAgentError =
    !hasPersonaAgents && !showAgentLoading && Boolean(agentsError);
  const agentTriggerLabel =
    displayAgent?.display_name ||
    displayAgent?.name ||
    (showAgentLoading
      ? t.sidebar.loadingAgents
      : showAgentError
        ? t.sidebar.agentsLoadFailed
        : t.sidebar.noAgents);
  const accountName = user ? getAccountDisplayName(user) : "";
  // The trigger represents the active persona; account identity lives in the menu.
  const accountLabel = accountName || t.sidebar.accountFallback;

  // Calculate evolution level and stars
  const level = evolutionData
    ? calculateLevel(evolutionData.learning_events)
    : null;
  const stars = level !== null ? calculateStars(level) : null;
  const roleLine = displayAgent
    ? t.sidebar.activeRoleLine(agentTriggerLabel)
    : agentTriggerLabel;
  // The button's accessible name comes from its contents, so the visible
  // level and stars are included automatically. This prefix keeps a stable
  // name when the text column is hidden in icon-collapsed mode.
  const accountMenuLabel = [accountLabel, roleLine].filter(Boolean).join("，");

  return (
    <div
      className={cn("flex items-center gap-1", compact && "desktop-account")}
    >
      <DropdownMenu open={agentMenuOpen} onOpenChange={setAgentMenuOpen}>
        <DropdownMenuTrigger asChild disabled={!compact && Boolean(lock)}>
          <button
            ref={accountTriggerRef}
            type="button"
            disabled={!compact && Boolean(lock)}
            data-testid={compact ? "desktop-account-menu" : undefined}
            title={
              compact
                ? roleLine
                : lock
                  ? t.sidebar.lockedAgentTooltip(
                      displayAgent?.display_name || displayAgent?.name || "",
                    )
                  : displayAgent?.description || agentTriggerLabel
            }
            className={cn(
              "group/agent flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left",
              "transition-[background-color] duration-fast",
              "hover:bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45",
              "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
              compact && "size-9 flex-none justify-center rounded-full p-0",
            )}
          >
            <span className="sr-only">{accountMenuLabel}</span>
            <span className="relative shrink-0" aria-hidden="true">
              {displayAgent ? (
                <AgentAvatar key={displayAgent.name} agent={displayAgent}
                  className="size-8 rounded-full border-0 text-sm ring-1 ring-foreground/10" />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {showAgentLoading ? <LoaderCircleIcon className="size-4 animate-spin" />
                    : showAgentError ? <AlertCircleIcon className="size-4 text-destructive" />
                    : <UserCircleIcon className="size-5" />}
                </span>
              )}
            </span>
            <span
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden",
                compact && "hidden",
              )}
            >
              <span className="truncate text-xs font-medium leading-tight">
                {accountLabel}
              </span>
              <span
                className={cn(
                  "truncate text-xs leading-tight text-muted-foreground",
                  showAgentError && "text-destructive",
                )}
              >
                {roleLine}
                {level !== null && (
                  <span className="ml-1.5">
                    Lv.{level}
                    {stars !== null && stars > 0 && (
                      <span
                        className="ml-0.5 inline-flex items-center gap-px align-[-1px]"
                        aria-label={`${Math.min(stars, 5)}★`}
                      >
                        {Array.from({ length: Math.min(stars, 5) }, (_, i) => (
                          <StarIcon
                            key={i}
                            aria-hidden
                            className="size-2.5 fill-current"
                          />
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </span>
            <span className="sr-only">
              {t.sidebar.accountMenuLabel(accountLabel, agentTriggerLabel)}
            </span>
            {!compact &&
              (lock ? (
                <span
                  className="shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
                  aria-hidden
                >
                  <LockIcon className="size-3" />
                </span>
              ) : (
                <span className="shrink-0 text-muted-foreground group-hover/agent:text-muted-foreground group-data-[collapsible=icon]:hidden">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </span>
              ))}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onPointerDownOutside={(event) => {
            // A closing menu can still receive the next trigger press while
            // a lazy surface is changing. Let the trigger toggle once.
            if (
              compact &&
              event.target instanceof Node &&
              accountTriggerRef.current?.contains(event.target)
            ) {
              event.preventDefault();
            }
          }}
          side={compact ? "right" : "top"}
          align={compact ? "end" : "start"}
          sideOffset={6}
          className="max-h-[calc(100vh-1rem)] w-[288px] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border-border-default p-1.5 shadow-[var(--shadow-floating)]"
        >
          <DropdownMenuItem
            onSelect={() => setCreditsOpen(true)}
            className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-xs focus:bg-foreground/[0.035]"
          >
            <UserCircleIcon className="size-4 shrink-0 opacity-70" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {accountLabel}
            </span>
            {typeof credits === "number" && Number.isFinite(credits) && (
              <>
                <CoinsIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="shrink-0 text-xs tabular-nums text-foreground/80">
                  {credits.toLocaleString()}
                </span>
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {compact && (
            <DropdownMenuItem
              onSelect={() => void _navigate("/workspace/settings")}
              className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
            >
              <SettingsIcon className="size-4 shrink-0 opacity-70" />
              <span>{t.sidebar.settingsTooltip}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => void _navigate("/workspace/organizations")}
            className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-xs focus:bg-foreground/[0.035]"
          >
            <UsersIcon className="size-4 shrink-0 opacity-70" />
            <span>{ORG_COPY[locale].title}</span>
          </DropdownMenuItem>
          {compact && hasPersonaAgents ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="min-h-9 gap-2 rounded-lg px-2 text-xs">
                <UsersIcon className="size-4 opacity-70" />
                {t.sidebar.switchAgentMenuTitle}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[70svh] w-[288px] overflow-y-auto">
                {personaAgents.map(renderAgentItem)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <>
              <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t.sidebar.switchAgentMenuTitle}
              </DropdownMenuLabel>
              {hasPersonaAgents ? (
                personaAgents.map(renderAgentItem)
              ) : showAgentLoading ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                  <span>{t.sidebar.loadingAgents}</span>
                </div>
              ) : showAgentError ? (
                <>
                  <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-destructive">
                    <AlertCircleIcon className="size-3.5 shrink-0" />
                    <span>{t.sidebar.agentsLoadFailed}</span>
                  </div>
                  <DropdownMenuItem
                    onSelect={() => void refetchAgents()}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs focus:bg-muted/60 focus:text-foreground"
                  >
                    <RefreshCwIcon className="size-3.5 shrink-0" />
                    <span>{t.sidebar.retryAgents}</span>
                  </DropdownMenuItem>
                </>
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  {t.sidebar.noAgents}
                </div>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void logout()}
            className="flex min-h-8 items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground focus:bg-foreground/[0.035] focus:text-foreground"
          >
            <LogOutIcon className="size-4 shrink-0 opacity-70" />
            <span>{t.sidebar.logout}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!compact && (
        <button
          type="button"
          title={t.sidebar.settingsTooltip}
          aria-label={t.sidebar.settingsTooltip}
          onClick={() => emitOpenSettings()}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
            "opacity-70 transition-[opacity,background-color,color] duration-fast",
            "hover:bg-muted hover:text-foreground hover:opacity-100",
            "group-data-[collapsible=icon]:hidden",
          )}
        >
          <SettingsIcon className="size-4" />
        </button>
      )}
      <CreditsCenterDialog open={creditsOpen} onOpenChange={setCreditsOpen} />
    </div>
  );
}
