import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

/**
 * One trigger below the input that summarises where and how the task runs
 * (workspace · work mode) and opens the per-run settings above it.
 *
 * The panel stays mounted while closed: the controls it holds have mount-time
 * effects (the mode selector hydrates the stored mode and runs project
 * detection), so unmounting them with the panel would change behaviour.
 */
export function ComposerRunSettings({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Nested menus portal to <body>, outside this DOM subtree. React still
  // bubbles their pointer events through this component, so mark them here
  // and let the document listener ignore them.
  const pointerInsideRef = useRef(false);
  const panelId = useId();
  const title = t.chatInputBox.runSettings;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // The trigger's own pointerdown marked "inside" before this listener
    // existed; clear it so the next outside press is not swallowed.
    pointerInsideRef.current = false;
    const onPointerDown = () => {
      const inside = pointerInsideRef.current;
      pointerInsideRef.current = false;
      if (!inside) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      onPointerDownCapture={() => {
        pointerInsideRef.current = true;
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="composer-run-settings-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        title={`${title}: ${summary}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-ui text-muted-foreground transition-colors",
          "hover:bg-muted/60 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-muted/60 text-foreground",
        )}
      >
        <SlidersHorizontalIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{title}: </span>
        <span className="truncate">{summary}</span>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 opacity-50 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="group"
        aria-label={title}
        data-testid="composer-run-settings-panel"
        hidden={!open}
        onKeyDown={(event) => {
          // An Escape from a nested (portaled) menu closes only that menu.
          if (
            event.key === "Escape" &&
            panelRef.current?.contains(event.target as Node)
          ) {
            event.stopPropagation();
            close(true);
          }
        }}
        className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-1.5rem)] space-y-0.5 rounded-xl border border-border-default bg-popover p-3 text-popover-foreground shadow-[var(--shadow-floating)]"
      >
        <p className="mb-1.5 text-ui-caption font-medium text-muted-foreground">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

/** A labelled row inside the run settings panel. */
export function ComposerRunSettingsRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 items-center justify-between gap-4 text-ui",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}
