import { LogOutIcon, UserIcon, SearchIcon, XIcon } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Suspense } from "react";
import { getSettingsUxCopy } from "./settings-ux-copy";
import AppearanceSettingsPage from "./appearance-settings-page";
import { CodingToolboxPanel } from "./coding-toolbox-panel";
import type { SettingsSection } from "./settings-sections";
import {
  AboutSettingsPage,
  AccountSettingsPage,
  AutomationSecuritySettingsPage,
  BrowserAutomationSettingsPage,
  ConversationSettingsPage,
  DesktopAutomationSettingsPage,
  McpSettingsPage,
  MemorySettingsPage,
  ModelSettingsPage,
  NotificationSettingsPage,
  PrivacySettingsPage,
  SettingsPageSkeleton,
  SubscriptionSettingsPage,
  preloadSettingsPages,
} from "./settings-dialog-pages";
import { buildSettingsSections } from "./settings-dialog-sections";
import { SettingsObservabilitySection } from "./settings-observability-section";
import { MIN_W, useSettingsDialogSize } from "./use-settings-dialog-size";

export {
  SETTINGS_SECTIONS,
  normalizeSettingsSection,
  type SettingsSection,
} from "./settings-sections";

import { useI18n } from "@/core/i18n/hooks";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { octApi } from "@/core/oct/api";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
};

function isPlaceholderUsername(username?: string | null): boolean {
  const value = username?.trim().toLowerCase();
  return !value || value === "anonymous" || value === "__anonymous__";
}

function getAccountDisplayName(
  user: {
    mobile?: string;
    email?: string;
    username?: string;
    actor_id?: string;
  } | null,
): string | null {
  if (!user) return null;
  return (
    user.mobile ||
    user.email ||
    (!isPlaceholderUsername(user.username) ? user.username : "") ||
    user.actor_id ||
    null
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { defaultSection = "appearance", ...dialogProps } = props;
  const { open: settingsOpen, onOpenChange: onSettingsOpenChange } = props;
  const { t, locale } = useI18n();
  const settingsUxCopy = getSettingsUxCopy(locale);
  const navigate = useNavigate();
  const location = useLocation();
  const openedRoute = useRef(location.pathname + location.search);
  useEffect(() => {
    const route = location.pathname + location.search;
    if (settingsOpen && openedRoute.current !== route)
      onSettingsOpenChange?.(false);
    openedRoute.current = route;
  }, [location.pathname, location.search, settingsOpen, onSettingsOpenChange]);
  const { user, logout, authStatus, isLoading } = useAuth();
  const accountName = getAccountDisplayName(user);
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  const { size, onResizeStart, onResizeKeyDown } = useSettingsDialogSize();
  const contentScrollRootRef = useRef<HTMLDivElement>(null);
  const sectionScrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [sectionScrollEdges, setSectionScrollEdges] = useState({
    before: false,
    after: false,
  });

  const updateSectionScrollEdges = useCallback(() => {
    const element = sectionScrollRef.current;
    if (!element) return;
    const maxScrollLeft = Math.max(
      0,
      element.scrollWidth - element.clientWidth,
    );
    setSectionScrollEdges({
      before: element.scrollLeft > 2,
      after: element.scrollLeft < maxScrollLeft - 2,
    });
  }, []);

  useEffect(() => {
    if (!dialogProps.open) return;
    // Each settings page can be much taller than the dialog. Never carry a
    // previous page's vertical position into the newly selected page: that
    // would make its heading appear clipped and suggests the tab failed to
    // switch. Wait one frame so the new Suspense child has mounted first.
    const frame = window.requestAnimationFrame(() => {
      const viewport = contentScrollRootRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (viewport) viewport.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, dialogProps.open]);

  useEffect(() => {
    // When opening the dialog, ensure the active section follows the caller's intent.
    // This allows triggers like "About" to open the dialog directly on that page.
    if (dialogProps.open) {
      setActiveSection(defaultSection);
      // Let the requested page paint first, then warm the remaining tabs while
      // the browser is idle. Starting every settings chunk synchronously made
      // the first dialog open compete with its own rendering work.
      const preload = () => preloadSettingsPages();
      const idleWindow: Window & {
        requestIdleCallback?: (
          callback: IdleRequestCallback,
          options?: IdleRequestOptions,
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      } = window;
      const idleHandle = idleWindow.requestIdleCallback?.(preload, {
        timeout: 2_000,
      });
      const timerHandle =
        idleHandle === undefined ? window.setTimeout(preload, 500) : undefined;

      // Prefetch the oct account bridge; individual account tabs can fetch
      // their own optional data when opened.
      void queryClient.prefetchQuery({
        queryKey: ["account", "oct"],
        queryFn: () => octApi.get().catch(() => null),
        staleTime: 30_000,
      });

      return () => {
        if (idleHandle !== undefined) {
          idleWindow.cancelIdleCallback?.(idleHandle);
        }
        if (timerHandle !== undefined) window.clearTimeout(timerHandle);
      };
    }
  }, [defaultSection, dialogProps.open, queryClient]);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success(t.auth.logoutSuccess);
      dialogProps.onOpenChange?.(false);
      void navigate("/");
    } catch {
      toast.error(t.auth.logoutFailed);
    }
  };

  const sections = useMemo(() => {
    const toolsLabel = locale.toLowerCase().startsWith("zh")
      ? "工具与集成"
      : locale.toLowerCase().startsWith("ja")
        ? "ツールと連携"
        : locale.toLowerCase().startsWith("ko")
          ? "도구 및 통합"
          : "Tools & integrations";
    const automationSecurityLabel = locale.toLowerCase().startsWith("zh")
      ? "执行与安全"
      : locale.toLowerCase().startsWith("ja")
        ? "自動化とセキュリティ"
        : locale.toLowerCase().startsWith("ko")
          ? "자동화 및 보안"
          : "Automation & security";

    return buildSettingsSections(
      {
        account: t.settings.sections.account,
        subscription: t.settings.sections.subscription,
        general: t.settings.sections.general,
        conversation: t.settings.sections.conversation,
        models: t.settings.model.title,
        memory: t.settings.sections.memory,
        notification: t.settings.sections.notification,
        coding: locale.toLowerCase().startsWith("zh") ? "编码" : "Coding",
        tools: toolsLabel,
        browserAutomation: locale.toLowerCase().startsWith("zh")
          ? "浏览器自动化"
          : "Browser automation",
        desktopAutomation: locale.toLowerCase().startsWith("zh")
          ? "桌面自动化"
          : "Desktop automation",
        automationSecurity: automationSecurityLabel,
        privacy: t.settings.sections.privacy,
        observability: t.settings.sections.observability,
        about: t.settings.sections.about,
      },
      t.settings.dialog.sectionKeywords,
    );
  }, [
    t.settings.sections.account,
    t.settings.sections.subscription,
    t.settings.sections.general,
    t.settings.sections.conversation,
    t.settings.model.title,
    t.settings.sections.memory,
    locale,
    t.settings.sections.notification,
    t.settings.sections.about,
    t.settings.sections.observability,
    t.settings.sections.privacy,
    t.settings.dialog.sectionKeywords,
  ]);
  const [settingsQuery, setSettingsQuery] = useState("");
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!normalizedSettingsQuery) return sections;
    return sections.filter((section) =>
      [section.id, section.label, ...section.keywords]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSettingsQuery),
    );
  }, [normalizedSettingsQuery, sections]);
  const hasSettingsResults = visibleSections.length > 0;

  useEffect(() => {
    if (!dialogProps.open) return;
    const updateSectionView = () => {
      const viewport = sectionScrollRef.current;
      const active = viewport?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (viewport && active && viewport.scrollWidth > viewport.clientWidth) {
        const bounds = viewport.getBoundingClientRect();
        const selected = active.getBoundingClientRect();
        const delta =
          selected.left < bounds.left + 12
            ? selected.left - bounds.left - 12
            : selected.right > bounds.right - 12
              ? selected.right - bounds.right + 12
              : 0;
        if (delta) viewport.scrollTo({ left: viewport.scrollLeft + delta });
      }
      updateSectionScrollEdges();
    };
    const frame = window.requestAnimationFrame(updateSectionView);
    window.addEventListener("resize", updateSectionView);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateSectionView);
    if (sectionScrollRef.current) observer?.observe(sectionScrollRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateSectionView);
      observer?.disconnect();
    };
  }, [
    dialogProps.open,
    activeSection,
    updateSectionScrollEdges,
    visibleSections.length,
  ]);

  const sectionGroupLabels = useMemo(() => {
    const isZh = locale.toLowerCase().startsWith("zh");
    const isJa = locale.toLowerCase().startsWith("ja");
    const isKo = locale.toLowerCase().startsWith("ko");
    return {
      account: isZh
        ? "账户与方案"
        : isJa
          ? "アカウントとプラン"
          : isKo
            ? "계정 및 요금제"
            : "Account & plan",
      workspace: isZh
        ? "体验与工作方式"
        : isJa
          ? "体験とワークフロー"
          : isKo
            ? "경험 및 작업 방식"
            : "Experience & workflow",
      capabilities: isZh
        ? "能力与安全"
        : isJa
          ? "機能とセキュリティ"
          : isKo
            ? "기능 및 보안"
            : "Capabilities & security",
      system: isZh
        ? "支持与诊断"
        : isJa
          ? "サポートと診断"
          : isKo
            ? "지원 및 진단"
            : "Support & diagnostics",
    } as const;
  }, [locale]);

  useEffect(() => {
    if (!dialogProps.open || !normalizedSettingsQuery || !hasSettingsResults) {
      return;
    }
    if (visibleSections.some((section) => section.id === activeSection)) {
      return;
    }
    const next = visibleSections.find((section) => !section.disabled);
    if (next) setActiveSection(next.id);
  }, [
    activeSection,
    dialogProps.open,
    hasSettingsResults,
    normalizedSettingsQuery,
    visibleSections,
  ]);

  return (
    <Dialog
      {...dialogProps}
      onOpenChange={(open) => props.onOpenChange?.(open)}
    >
      <DialogContent
        closeLabel={t.common.close}
        className="flex h-[min(760px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden overflow-y-clip p-0 sm:max-w-5xl md:max-w-6xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        style={
          size
            ? {
                width: size.w,
                height: size.h,
                maxWidth: "calc(100vw - 2rem)",
                maxHeight: "calc(100vh - 2rem)",
              }
            : undefined
        }
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 gap-0 border-b border-border/60 px-5 pb-4 pt-5 text-left sm:px-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-12">
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="text-ui-title outline-none"
            >
              {t.settings.title}
            </DialogTitle>
            <p className="text-ui text-muted-foreground">
              {t.settings.description}
            </p>
          </div>
          {!isLoading && (user || authStatus?.enabled) ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UserIcon className="size-3.5" />
                  <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-background bg-success" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-medium">
                    {accountName ?? t.auth.notLoggedIn}
                  </p>
                  <p className="text-ui-caption truncate text-muted-foreground">
                    {user?.email && user.email !== accountName
                      ? user.email
                      : t.auth.currentAccount}
                  </p>
                </div>
              </div>
              {user ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-ui shadow-none"
                  onClick={handleLogout}
                >
                  <LogOutIcon className="mr-1 size-3.5" />
                  {t.auth.logout}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-ui shadow-none"
                  onClick={() => {
                    dialogProps.onOpenChange?.(false);
                    void navigate("/login");
                  }}
                >
                  <LogOutIcon className="mr-1 size-3.5" />
                  {t.auth.loginAccount}
                </Button>
              )}
            </div>
          ) : null}
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[216px_minmax(0,1fr)] md:grid-rows-[1fr]">
          <nav className="flex min-h-0 flex-col overflow-hidden border-b border-border/60 bg-sidebar/60 p-2 md:max-h-none md:border-b-0 md:border-r md:p-3">
            <div className="relative mb-2 hidden md:block">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
              <Input
                // This field only filters the section list, but a bare text
                // input is indistinguishable from a login field to the
                // browser's password manager: it auto-fills the saved account
                // and dispatches an input event, which React turns into a
                // search term, so opening Settings looks like it "searched for
                // my account". type=search plus autoComplete=off keeps autofill
                // out; the cancel decoration is hidden because we render our
                // own clear button on top of it.
                type="search"
                name="echo-settings-search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={settingsQuery}
                onChange={(event) => setSettingsQuery(event.target.value)}
                placeholder={t.settings.dialog.searchPlaceholder}
                aria-label={t.settings.dialog.searchPlaceholder}
                className="h-9 rounded-lg bg-background pl-8 pr-8 text-ui shadow-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {settingsQuery ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 opacity-60 hover:opacity-100"
                  onClick={() => setSettingsQuery("")}
                  aria-label={t.settings.dialog.clearSearch}
                >
                  <XIcon className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="mb-1 hidden items-center justify-between px-2 text-ui-caption font-medium text-muted-foreground md:flex">
              <span>{t.settings.dialog.sectionsLabel}</span>
              {normalizedSettingsQuery ? (
                <span>
                  {t.settings.dialog.resultsCount(visibleSections.length)}
                </span>
              ) : null}
            </div>
            <div className="relative min-h-0 flex-1">
              <div
                ref={sectionScrollRef}
                data-testid="settings-section-scroll"
                onScroll={updateSectionScrollEdges}
                className="h-full min-h-0 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-x-hidden md:overflow-y-auto md:[scrollbar-width:thin]"
              >
                <ul className="flex w-max min-w-full flex-nowrap gap-0.5 pr-6 md:block md:w-full md:min-w-0 md:space-y-1 md:pr-0">
                  {visibleSections.map(
                    (
                      {
                        id,
                        label,
                        icon: Icon,
                        group,
                        disabled,
                        disabledReason,
                      },
                      index,
                    ) => {
                      const active = activeSection === id;
                      return (
                        <Fragment key={id}>
                          {index === 0 ||
                          visibleSections[index - 1]?.group !== group ? (
                            <li
                              aria-hidden="true"
                              className="hidden items-center px-2 pb-1.5 pt-4 text-ui-caption font-medium text-muted-foreground first:pt-1 md:flex"
                            >
                              <span>{sectionGroupLabels[group]}</span>
                            </li>
                          ) : null}
                          <li className="shrink-0 md:w-full">
                            <button
                              type="button"
                              onClick={() => {
                                if (disabled) return;
                                setActiveSection(id);
                              }}
                              disabled={disabled}
                              title={disabled ? disabledReason : undefined}
                              aria-disabled={disabled || undefined}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                // Keep the nav quiet: one active tint and a
                                // slim leading accent are enough for hierarchy.
                                "group/sec relative flex h-12 w-auto min-w-max items-center gap-2 rounded-lg px-2.5 text-ui transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:h-9 md:w-full",
                                disabled
                                  ? "cursor-not-allowed opacity-40"
                                  : "cursor-pointer text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                                active &&
                                  "bg-primary/8 font-medium text-foreground after:absolute after:bottom-0 after:left-2.5 after:right-2.5 after:h-[2px] after:rounded-t after:bg-primary/75 md:after:hidden md:before:absolute md:before:bottom-2 md:before:left-0 md:before:top-2 md:before:w-[2px] md:before:rounded-r md:before:bg-primary/70",
                              )}
                            >
                              <Icon className="size-4" />
                              <span className="flex-1 truncate text-left">
                                {label}
                              </span>
                              {disabled && (
                                <span className="rounded border border-border-default px-1 py-0.5 text-xs font-medium leading-none text-muted-foreground">
                                  {t.common.guest}
                                </span>
                              )}
                            </button>
                          </li>
                        </Fragment>
                      );
                    },
                  )}
                </ul>
                {!hasSettingsResults ? (
                  <div className="text-muted-foreground px-2 py-8 text-center text-xs">
                    {t.settings.dialog.noSearchResultsTitle}
                  </div>
                ) : null}
              </div>
              {sectionScrollEdges.before ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 z-10 w-7 bg-gradient-to-r from-sidebar via-sidebar/85 to-transparent md:hidden"
                />
              ) : null}
              {sectionScrollEdges.after ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 z-10 w-7 bg-gradient-to-l from-sidebar via-sidebar/85 to-transparent md:hidden"
                />
              ) : null}
            </div>
          </nav>
          <ScrollArea
            ref={contentScrollRootRef}
            className="h-full min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full [&_[data-slot=scroll-area-viewport]>div]:!min-w-0"
          >
            <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 overflow-x-hidden p-5 sm:p-6 lg:p-8">
              {/* Each tab gets its own Suspense boundary so switching
                  to an uncached tab doesn't blank out the currently
                  mounted one. Combined with preloadSettingsPages() this
                  effectively removes the "every tab reloads" flicker
                  users were seeing. */}
              {!hasSettingsResults ? (
                <Empty className="min-h-[420px] border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SearchIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t.settings.dialog.noSearchResultsTitle}
                    </EmptyTitle>
                    <EmptyDescription>
                      {t.settings.dialog.noSearchResultsDescription}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {hasSettingsResults && activeSection === "account" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <AccountSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "subscription" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <SubscriptionSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "appearance" && (
                <AppearanceSettingsPage />
              )}
              {hasSettingsResults && activeSection === "conversation" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <ConversationSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "models" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <ModelSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "coding" && (
                <section
                  aria-labelledby="settings-coding-title"
                  className="space-y-4"
                >
                  <header className="space-y-1.5">
                    <h2
                      id="settings-coding-title"
                      className="text-lg font-semibold tracking-tight"
                    >
                      {locale.toLowerCase().startsWith("zh")
                        ? "编码"
                        : "Coding"}
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      {locale.toLowerCase().startsWith("zh")
                        ? "管理编码工作流、项目连接、执行环境与并行工作树。"
                        : "Manage coding workflows, project connections, execution environments, and parallel worktrees."}
                    </p>
                  </header>
                  <CodingToolboxPanel
                    onOpen={(target) => {
                      setActiveSection(
                        target === "tools" ? "tools" : "automationSecurity",
                      );
                    }}
                  />
                </section>
              )}
              {hasSettingsResults && activeSection === "memory" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <MemorySettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "tools" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <McpSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "automationSecurity" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <AutomationSecuritySettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "browserAutomation" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <BrowserAutomationSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "desktopAutomation" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <DesktopAutomationSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "privacy" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <PrivacySettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "notification" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <NotificationSettingsPage />
                </Suspense>
              )}
              {hasSettingsResults && activeSection === "observability" && (
                <SettingsObservabilitySection
                  copy={settingsUxCopy.observability}
                  onOpenDashboard={() => {
                    dialogProps.onOpenChange?.(false);
                    void navigate("/workspace/observability");
                  }}
                />
              )}
              {hasSettingsResults && activeSection === "about" && (
                <Suspense fallback={<SettingsPageSkeleton />}>
                  <AboutSettingsPage />
                </Suspense>
              )}
            </div>
          </ScrollArea>
        </div>
        {/* Resize handle — sits in the bottom-right corner. We keep the
            clickable area a bit bigger than the visual glyph so it's easy
            to grab without overlapping close-button or scrollbars. */}
        <div
          onMouseDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label={t.settings.dialog.dragToResize}
          aria-valuenow={size ? Math.round(size.w) : undefined}
          aria-valuemin={MIN_W}
          aria-valuemax={
            typeof window !== "undefined" ? window.innerWidth - 32 : undefined
          }
          title={t.settings.dialog.dragToResize}
          tabIndex={0}
          className="absolute bottom-0 right-0 z-50 hidden size-5 cursor-nwse-resize items-end justify-end rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:flex"
        >
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
            <path
              d="M0 10 L10 0 M4 10 L10 4 M8 10 L10 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
}
