import { PinIcon, PinOffIcon, PuzzleIcon, Settings2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { BrowserExtensionAction } from "@/types/electron";

const BUTTON =
  "relative grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

function anchorOf(element: HTMLElement) {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

function ActionIcon({ action }: { action: BrowserExtensionAction }) {
  return action.icon ? (
    <img src={action.icon} alt="" className="size-4 object-contain" />
  ) : (
    <span className="grid size-4 place-items-center rounded bg-muted text-micro font-semibold uppercase text-muted-foreground">
      {action.name.slice(0, 1)}
    </span>
  );
}

function Badge({ action }: { action: BrowserExtensionAction }) {
  if (!action.badgeText) return null;
  return (
    <span
      className="pointer-events-none absolute -bottom-0.5 -right-0.5 min-w-3.5 rounded px-0.5 text-center text-micro font-semibold leading-3.5"
      style={{
        background: action.badgeColor || "var(--color-muted-foreground)",
        color: action.badgeTextColor || "#fff",
      }}
    >
      {action.badgeText.slice(0, 4)}
    </span>
  );
}

/**
 * Browser extensions on the toolbar, as in Chrome: pinned extensions get a
 * button (icon, badge, popup), all of them are in the puzzle menu. Right
 * click a button for the extension's own menu items, options and pinning.
 */
export function ExtensionToolbar({
  webContentsId,
  onManage,
}: {
  webContentsId: number | null;
  onManage?: () => void;
}) {
  const api =
    typeof window === "undefined" ? undefined : window.echo?.extensions;
  const [actions, setActions] = useState<BrowserExtensionAction[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const puzzleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!api?.actions) return;
    const result = await api.actions(webContentsId);
    if (result.ok) setActions(result.actions);
  }, [api, webContentsId]);

  useEffect(() => {
    void refresh();
    return window.echo?.on("browser:extension-actions-changed", () => {
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (puzzleRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    // Clicks inside a page never reach this document; the shell relays them.
    const offPage = window.echo?.on("browser:webview-pointer", () =>
      setMenuOpen(false),
    );
    return () => {
      window.removeEventListener("mousedown", close);
      offPage?.();
    };
  }, [menuOpen]);

  if (!api?.actions || actions.length === 0) return null;

  const run = (action: BrowserExtensionAction, element: HTMLElement) =>
    void api.clickAction(action.id, webContentsId, anchorOf(element));
  const showMenu = (action: BrowserExtensionAction) =>
    void api.showActionMenu(action.id, webContentsId);
  const label = (action: BrowserExtensionAction) =>
    action.badgeText ? `${action.title}（${action.badgeText}）` : action.title;

  return (
    <div className="flex shrink-0 items-center">
      {actions
        .filter((action) => action.pinned)
        .map((action) => (
          <button
            key={action.id}
            type="button"
            className={cn(BUTTON, !action.enabled && "opacity-45 grayscale")}
            title={label(action)}
            aria-label={label(action)}
            data-extension-action={action.id}
            onClick={(event) => {
              if (action.enabled) run(action, event.currentTarget);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              showMenu(action);
            }}
          >
            <ActionIcon action={action} />
            <Badge action={action} />
          </button>
        ))}
      <div className="relative">
        <button
          ref={puzzleRef}
          type="button"
          className={cn(BUTTON, menuOpen && "bg-foreground/5 text-foreground")}
          title="扩展"
          aria-label="扩展"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <PuzzleIcon className="size-4" />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            <div className="px-2 pb-1 pt-0.5 text-xs font-semibold text-muted-foreground">
              扩展
            </div>
            {actions.map((action) => (
              <div
                key={action.id}
                className="group flex items-center gap-1 rounded-lg hover:bg-muted/70"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={!action.enabled}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-sm disabled:opacity-50"
                  onClick={() => {
                    setMenuOpen(false);
                    // A popup opens under the puzzle button when the
                    // extension has no button of its own.
                    if (puzzleRef.current) run(action, puzzleRef.current);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    showMenu(action);
                  }}
                >
                  <span className="relative">
                    <ActionIcon action={action} />
                  </span>
                  <span className="truncate">{action.name}</span>
                  {action.badgeText ? (
                    <span className="shrink-0 rounded bg-muted px-1 text-micro text-muted-foreground">
                      {action.badgeText.slice(0, 4)}
                    </span>
                  ) : null}
                </button>
                {action.hasOptions ? (
                  <button
                    type="button"
                    title={`${action.name} 选项`}
                    aria-label={`${action.name} 选项`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      setMenuOpen(false);
                      void api.openOptions(action.id);
                    }}
                  >
                    <Settings2Icon className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  title={action.pinned ? "从工具栏取消固定" : "固定到工具栏"}
                  aria-label={`${action.pinned ? "取消固定" : "固定"} ${action.name}`}
                  aria-pressed={action.pinned}
                  className={cn(
                    "mr-1 grid size-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-background",
                    action.pinned
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => void api.setPinned(action.id, !action.pinned)}
                >
                  {action.pinned ? (
                    <PinIcon className="size-3.5" />
                  ) : (
                    <PinOffIcon className="size-3.5" />
                  )}
                </button>
              </div>
            ))}
            {onManage ? (
              <>
                <div className="my-1 h-px bg-border/55" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  onClick={() => {
                    setMenuOpen(false);
                    onManage();
                  }}
                >
                  <PuzzleIcon className="size-4" />
                  管理扩展
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
