import * as ContextMenu from "@radix-ui/react-context-menu";
import { EllipsisIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MessageMenuAction {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

export function MessageContextMenu({
  children,
  actions,
  extra,
}: {
  children: ReactElement;
  actions: MessageMenuAction[];
  extra?: ReactNode;
}) {
  if (!actions.length) return children;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onContextMenuCapture={(event) => {
          // Preserve the browser's actions for selected text, links and inputs.
          if (
            window.getSelection()?.toString() ||
            (event.target instanceof Element &&
              event.target.closest(
                "a, input, textarea, pre, [contenteditable=true]",
              ))
          ) {
            event.stopPropagation();
          }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-40 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto rounded-xl border border-border-default bg-popover p-1 text-popover-foreground shadow-[var(--shadow-floating)]"
          collisionPadding={8}
        >
          {actions.map((action) => (
            <ContextMenu.Item
              key={action.id}
              onSelect={action.onSelect}
              className="flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
            >
              {action.icon}
              {action.label}
            </ContextMenu.Item>
          ))}
          {extra}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function MessageMoreActions({
  actions,
  label,
  children,
  quickActionIds = [],
}: {
  actions: MessageMenuAction[];
  label: string;
  children?: ReactNode;
  quickActionIds?: string[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-7 items-center justify-center rounded-lg hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
        >
          <EllipsisIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8}>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            onSelect={action.onSelect}
            className={
              quickActionIds.includes(action.id)
                ? "hidden [@media(hover:none)]:flex"
                : undefined
            }
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
