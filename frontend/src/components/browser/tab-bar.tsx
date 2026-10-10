import {
  CheckIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  DnaIcon,
  EyeOffIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  GlobeIcon,
  Loader2Icon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  TriangleAlertIcon,
  UngroupIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import {
  BROWSER_HOME_URL,
  type BrowserTab,
  type BrowserTabGroup,
  useBrowserStore,
} from "./browser-store";
import { TAB_GROUP_COLORS, type TabGroupColor } from "./tab-layout";

const TAB_LIST_THRESHOLD = 6;

export const TAB_GROUP_COLOR_VALUES: Record<TabGroupColor, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  yellow: "#eab308",
  green: "#22c55e",
  pink: "#ec4899",
  purple: "#a855f7",
  cyan: "#06b6d4",
  orange: "#f97316",
  grey: "#6b7280",
};

const TAB_GROUP_COLOR_NAMES: Record<TabGroupColor, string> = {
  blue: "蓝色",
  red: "红色",
  yellow: "黄色",
  green: "绿色",
  pink: "粉色",
  purple: "紫色",
  cyan: "青色",
  orange: "橙色",
  grey: "灰色",
};

/** Tabs that can sit in a split pane: real pages in the desktop app. */
function canSplit(tab: BrowserTab | undefined | null): boolean {
  return Boolean(
    tab &&
    typeof window !== "undefined" &&
    window.echo?.isElectron &&
    tab.url !== BROWSER_HOME_URL &&
    !tab.taskPreview,
  );
}

function MenuItem({
  icon,
  children,
  onSelect,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
    >
      <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function GroupDot({ color }: { color: TabGroupColor }) {
  return (
    <span
      className="size-2.5 rounded-full"
      style={{ backgroundColor: TAB_GROUP_COLOR_VALUES[color] }}
    />
  );
}

function TabIcon({ tab }: { tab: BrowserTab }) {
  if (tab.crash) {
    return <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />;
  }
  if (tab.isLoading) {
    return <Loader2Icon className="size-3.5 shrink-0 animate-spin" />;
  }
  if (tab.private) {
    return <EyeOffIcon className="size-3.5 shrink-0 text-violet-500" />;
  }
  if (tab.url === BROWSER_HOME_URL) {
    return <DnaIcon className="size-3.5 shrink-0 text-primary" />;
  }
  if (tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        className="size-3.5 shrink-0"
        onError={(event) => (event.currentTarget.style.display = "none")}
      />
    );
  }
  return <GlobeIcon className="size-3.5 shrink-0 opacity-60" />;
}

export function TabBar() {
  const { t } = useI18n();
  const tb = t.browser.tabBar;
  const {
    state,
    activeTab,
    openTab,
    closeTab,
    activateTab,
    reorderTab,
    setTabPinned,
    addTabToGroup,
    removeTabFromGroup,
    updateGroup,
    ungroup,
    closeGroup,
    setSplit,
  } = useBrowserStore();
  // Right-click menus: a page tab, or a group chip.
  const [tabMenu, setTabMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    if (!tabMenu && !groupMenu) return;
    const close = () => {
      setTabMenu(null);
      setGroupMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [tabMenu, groupMenu]);
  const groupsById = useMemo(
    () => new Map(state.groups.map((group) => [group.id, group])),
    [state.groups],
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [tabListOpen, setTabListOpen] = useState(false);
  const tabElements = useRef(new Map<string, HTMLDivElement>());

  const pinnedHomeTab = useMemo(
    () => state.tabs.find((tab) => tab.url === BROWSER_HOME_URL) ?? null,
    [state.tabs],
  );
  const pageTabs = useMemo(
    () => state.tabs.filter((tab) => tab.id !== pinnedHomeTab?.id),
    [pinnedHomeTab?.id, state.tabs],
  );
  const crowded = pageTabs.length > 8;

  useEffect(() => {
    const activeElement = state.activeId
      ? tabElements.current.get(state.activeId)
      : undefined;
    activeElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [state.activeId]);

  const handleAuxClick = (event: MouseEvent, tab: BrowserTab) => {
    if (event.button === 1) {
      event.preventDefault();
      // Pinned tabs are kept on purpose; close them from the menu.
      if (!tab.pinned) closeTab(tab.id);
    }
  };

  const handleDragStart = (event: DragEvent, id: string) => {
    setDragId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (!dragId || dragId === targetId) return;
    const fromIndex = state.tabs.findIndex((tab) => tab.id === dragId);
    const toIndex = state.tabs.findIndex((tab) => tab.id === targetId);
    if (fromIndex >= 0 && toIndex >= 0) reorderTab(fromIndex, toIndex);
    setDragId(null);
    setDragOverId(null);
  };

  const renderTab = (tab: BrowserTab, fixed = false) => {
    const active = state.activeId === tab.id;
    const isHomeTab = tab.url === BROWSER_HOME_URL;
    const tabLabel = isHomeTab
      ? fixed
        ? tb.homeTabShort
        : t.browser.newTabPage
      : tab.title || tab.url;
    const iconOnly = !fixed && Boolean(tab.pinned);
    const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
    const inSplit =
      state.split?.leftId === tab.id || state.split?.rightId === tab.id;
    return (
      <div
        key={tab.id}
        ref={(element) => {
          if (element) tabElements.current.set(tab.id, element);
          else tabElements.current.delete(tab.id);
        }}
        data-testid={fixed ? "browser-home-tab" : "browser-page-tab"}
        data-active={active}
        draggable={!fixed}
        onDragStart={(event) => handleDragStart(event, tab.id)}
        onDragOver={(event) => {
          if (fixed) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverId(tab.id);
        }}
        onDrop={(event) => handleDrop(event, tab.id)}
        onDragEnd={() => {
          setDragId(null);
          setDragOverId(null);
        }}
        onClick={() => activateTab(tab.id)}
        onAuxClick={(event) => handleAuxClick(event, tab)}
        onContextMenu={(event) => {
          if (fixed) return;
          event.preventDefault();
          setGroupMenu(null);
          setTabMenu({ id: tab.id, x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateTab(tab.id);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={tab.private ? `无痕 · ${tabLabel}` : tabLabel}
        className={cn(
          "group relative flex h-7 cursor-pointer items-center gap-1 overflow-hidden rounded-md px-2 text-mini transition-[background-color,border-color,box-shadow,color,transform] after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform",
          fixed
            ? "w-[76px] shrink-0"
            : iconOnly
              ? "w-8 shrink-0 justify-center px-0"
              : crowded
                ? "min-w-[64px] max-w-[132px]"
                : "min-w-[84px] max-w-[160px]",
          tab.private && "bg-violet-500/10",
          active
            ? "bg-card/90 text-foreground shadow-[var(--shadow-xs)] after:scale-x-100"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          !fixed && dragOverId === tab.id && dragId !== tab.id
            ? "ring-2 ring-primary ring-offset-0"
            : null,
        )}
        style={
          {
            flex: fixed
              ? "0 0 76px"
              : iconOnly
                ? "0 0 32px"
                : crowded
                  ? "1 1 112px"
                  : "1 1 152px",
            WebkitAppRegion: "no-drag",
            ...(group
              ? {
                  boxShadow: `inset 0 -2px 0 ${TAB_GROUP_COLOR_VALUES[group.color]}`,
                }
              : null),
          } as CSSProperties
        }
        title={tab.title || tab.url}
        data-group={group?.id}
      >
        <TabIcon tab={tab} />
        {inSplit ? (
          <Columns2Icon
            className="size-3 shrink-0 text-primary"
            aria-label="分屏中"
          />
        ) : null}
        {iconOnly ? null : (
          <span className="min-w-0 flex-1 truncate">{tabLabel}</span>
        )}
        {iconOnly ? null : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeTab(tab.id);
            }}
            className="grid size-3.5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-100"
            data-active={active}
            title={tb.close}
            aria-label={`${tb.close} ${tabLabel}`}
          >
            <XIcon className="size-2.5" />
          </button>
        )}
      </div>
    );
  };
  const menuTab = tabMenu
    ? state.tabs.find((tab) => tab.id === tabMenu.id)
    : undefined;
  const menuGroup = groupMenu ? groupsById.get(groupMenu.id) : undefined;
  const closeMenus = () => {
    setTabMenu(null);
    setGroupMenu(null);
  };

  const renderGroupChip = (group: BrowserTabGroup, count: number) => (
    <button
      key={`group-${group.id}`}
      type="button"
      data-testid="browser-tab-group"
      onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}
      onContextMenu={(event) => {
        event.preventDefault();
        setTabMenu(null);
        setGroupMenu({ id: group.id, x: event.clientX, y: event.clientY });
      }}
      aria-expanded={!group.collapsed}
      aria-label={`标签组 ${group.title || "未命名"}，${count} 个标签`}
      title={`${group.title || "未命名分组"} · ${count} 个标签（右键编辑）`}
      className="flex h-6 max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 text-mini font-medium"
      style={
        {
          color: TAB_GROUP_COLOR_VALUES[group.color],
          backgroundColor: `${TAB_GROUP_COLOR_VALUES[group.color]}22`,
          WebkitAppRegion: "no-drag",
        } as CSSProperties
      }
    >
      {group.title ? (
        <span className="truncate">{group.title}</span>
      ) : (
        <GroupDot color={group.color} />
      )}
      {group.collapsed ? (
        <span className="rounded bg-current/15 px-1 text-[10px] leading-4">
          {count}
        </span>
      ) : null}
    </button>
  );

  // Page tabs with a chip before each group; collapsed groups hide tabs.
  const stripItems: ReactNode[] = [];
  for (let index = 0; index < pageTabs.length; index += 1) {
    const tab = pageTabs[index]!;
    const group = tab.groupId ? groupsById.get(tab.groupId) : undefined;
    if (group && pageTabs[index - 1]?.groupId !== group.id) {
      const count = pageTabs.filter((t) => t.groupId === group.id).length;
      stripItems.push(renderGroupChip(group, count));
    }
    if (!group?.collapsed) stripItems.push(renderTab(tab));
  }

  return (
    <div
      className="flex h-7 min-w-0 flex-1 items-center gap-0.5 bg-transparent"
      style={{ WebkitAppRegion: "drag" } as CSSProperties}
      data-testid="browser-tab-bar"
    >
      {pinnedHomeTab ? renderTab(pinnedHomeTab, true) : null}
      {tabMenu && menuTab ? (
        <div
          role="menu"
          aria-label="标签页操作"
          className="fixed z-[200] w-48 rounded-lg border border-border-subtle bg-popover p-1 text-xs text-popover-foreground shadow-lg"
          style={
            {
              left: tabMenu.x,
              top: tabMenu.y,
              WebkitAppRegion: "no-drag",
            } as CSSProperties
          }
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setTabPinned(menuTab.id, !menuTab.pinned);
              setTabMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            {menuTab.pinned ? (
              <PinOffIcon className="size-3.5" />
            ) : (
              <PinIcon className="size-3.5" />
            )}
            {menuTab.pinned ? "取消固定" : "固定标签页"}
          </button>
          <div className="my-1 h-px bg-border-subtle" />
          <MenuItem
            icon={<FolderPlusIcon className="size-3.5" />}
            onSelect={() => {
              addTabToGroup(menuTab.id);
              closeMenus();
            }}
          >
            添加到新分组
          </MenuItem>
          {state.groups
            .filter((group) => group.id !== menuTab.groupId)
            .map((group) => (
              <MenuItem
                key={group.id}
                icon={<GroupDot color={group.color} />}
                onSelect={() => {
                  addTabToGroup(menuTab.id, group.id);
                  closeMenus();
                }}
              >
                添加到「{group.title || TAB_GROUP_COLOR_NAMES[group.color]}」
              </MenuItem>
            ))}
          {menuTab.groupId ? (
            <MenuItem
              icon={<FolderMinusIcon className="size-3.5" />}
              onSelect={() => {
                removeTabFromGroup(menuTab.id);
                closeMenus();
              }}
            >
              移出分组
            </MenuItem>
          ) : null}
          {state.split &&
          (state.split.leftId === menuTab.id ||
            state.split.rightId === menuTab.id) ? (
            <>
              <div className="my-1 h-px bg-border-subtle" />
              <MenuItem
                icon={<Columns2Icon className="size-3.5" />}
                onSelect={() => {
                  setSplit(null);
                  closeMenus();
                }}
              >
                退出分屏
              </MenuItem>
            </>
          ) : canSplit(menuTab) &&
            canSplit(activeTab) &&
            activeTab?.id !== menuTab.id ? (
            <>
              <div className="my-1 h-px bg-border-subtle" />
              <MenuItem
                icon={<Columns2Icon className="size-3.5" />}
                onSelect={() => {
                  setSplit({ leftId: activeTab!.id, rightId: menuTab.id });
                  closeMenus();
                }}
              >
                与当前标签分屏
              </MenuItem>
            </>
          ) : null}
          <div className="my-1 h-px bg-border-subtle" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeTab(menuTab.id);
              setTabMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            <XIcon className="size-3.5" />
            {tb.close}
          </button>
        </div>
      ) : null}
      {groupMenu && menuGroup ? (
        <div
          role="menu"
          aria-label="标签组操作"
          className="fixed z-[200] w-52 rounded-lg border border-border-subtle bg-popover p-2 text-xs text-popover-foreground shadow-lg"
          style={
            {
              left: groupMenu.x,
              top: groupMenu.y,
              WebkitAppRegion: "no-drag",
            } as CSSProperties
          }
          onMouseDown={(event) => event.stopPropagation()}
        >
          <input
            key={menuGroup.id}
            defaultValue={menuGroup.title}
            autoFocus
            aria-label="分组名称"
            placeholder="为分组命名"
            maxLength={40}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                updateGroup(menuGroup.id, {
                  title: event.currentTarget.value.trim(),
                });
                closeMenus();
              }
            }}
            onBlur={(event) =>
              updateGroup(menuGroup.id, {
                title: event.currentTarget.value.trim(),
              })
            }
            className="mb-2 h-7 w-full rounded-md border border-border-subtle bg-background px-2 outline-none focus:border-primary/40"
          />
          <div
            className="mb-1 flex flex-wrap gap-1.5 px-0.5"
            role="group"
            aria-label="分组颜色"
          >
            {TAB_GROUP_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={TAB_GROUP_COLOR_NAMES[color]}
                aria-pressed={menuGroup.color === color}
                onClick={() => updateGroup(menuGroup.id, { color })}
                className={cn(
                  "grid size-5 place-items-center rounded-full",
                  menuGroup.color === color &&
                    "ring-2 ring-offset-1 ring-offset-popover",
                )}
                style={
                  {
                    backgroundColor: TAB_GROUP_COLOR_VALUES[color],
                    "--tw-ring-color": TAB_GROUP_COLOR_VALUES[color],
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="my-1 h-px bg-border-subtle" />
          <MenuItem
            icon={<UngroupIcon className="size-3.5" />}
            onSelect={() => {
              ungroup(menuGroup.id);
              closeMenus();
            }}
          >
            取消分组
          </MenuItem>
          <MenuItem
            icon={<XIcon className="size-3.5" />}
            onSelect={() => {
              closeGroup(menuGroup.id);
              closeMenus();
            }}
          >
            关闭分组
          </MenuItem>
        </div>
      ) : null}

      <div
        className="flex h-7 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="browser-scrollable-tabs"
        onWheel={(event) => {
          if (event.deltaY === 0) return;
          event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {stripItems}
      </div>

      {state.tabs.length >= TAB_LIST_THRESHOLD ? (
        <button
          type="button"
          onClick={() => setTabListOpen(true)}
          className="relative grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          title={`${t.browser.tabs.label} · ${state.tabs.length}`}
          aria-label={`${t.browser.tabs.label} · ${state.tabs.length}`}
          data-testid="browser-all-tabs-trigger"
        >
          <ChevronsUpDownIcon className="size-3.5" />
          <span className="absolute -right-0.5 -top-0.5 min-w-3 rounded-full bg-primary px-0.5 text-center text-micro leading-3 text-primary-foreground">
            {state.tabs.length > 99 ? "99+" : state.tabs.length}
          </span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => openTab()}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        title={tb.newTab}
        aria-label={tb.newTab}
        data-testid="browser-new-tab"
      >
        <PlusIcon className="size-3.5" />
      </button>

      <CommandDialog
        open={tabListOpen}
        onOpenChange={setTabListOpen}
        title={t.browser.tabs.label}
        description={t.browser.searchPlaceholder}
        className="sm:max-w-[520px]"
      >
        <CommandInput placeholder={t.browser.searchPlaceholder} />
        <CommandList>
          <CommandEmpty>{t.browser.empty.noMatch}</CommandEmpty>
          <CommandGroup
            heading={`${t.browser.tabs.label} · ${state.tabs.length}`}
          >
            {state.tabs.map((tab) => {
              const isActive = state.activeId === tab.id;
              const label =
                tab.id === pinnedHomeTab?.id
                  ? tb.homeTabShort
                  : tab.url === BROWSER_HOME_URL
                    ? t.browser.newTabPage
                    : tab.title || tab.url;
              return (
                <CommandItem
                  key={tab.id}
                  value={`${label} ${tab.url}`}
                  onSelect={() => {
                    activateTab(tab.id);
                    setTabListOpen(false);
                  }}
                  className="group/tab"
                >
                  <TabIcon tab={tab} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {tab.url}
                    </span>
                  </span>
                  {isActive ? (
                    <CheckIcon className="size-3.5 text-primary" />
                  ) : null}
                  <button
                    type="button"
                    className="grid size-6 shrink-0 place-items-center rounded-md opacity-0 transition-opacity hover:bg-foreground/10 group-hover/tab:opacity-100"
                    aria-label={`${tb.close} ${label}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <XIcon className="size-3" />
                  </button>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
