import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one ECHO app tile (BRAND.md, 图标): a graphite rounded square with a
 * snow line icon. Colour is state, never decoration, so a tile has no
 * per-app hue; the Echo Core accent only lights the icon and edge while the
 * enclosing `group` is hovered, focused or pressed, or when `active`.
 *
 * The tile pins the graphite scope itself, so it reads the same on the snow
 * workspace and on the graphite desktop. Callers set size and radius.
 */
export function EchoAppTile({
  icon: Icon,
  active = false,
  className,
  iconClassName,
}: {
  icon: LucideIcon;
  active?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="echo-app-tile"
      data-echo-theme="graphite"
      data-active={active ? "" : undefined}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-xl bg-card text-foreground ring-1 ring-border shadow-[var(--shadow-md)] transition-[color,box-shadow] duration-fast",
        "group-hover:text-core group-hover:ring-core/40 group-focus-visible:text-core group-focus-visible:ring-core/60 group-active:text-core data-[active]:text-core data-[active]:ring-core/60",
        className,
      )}
    >
      <Icon className={cn("size-1/2", iconClassName)} strokeWidth={1.5} />
    </span>
  );
}
