import { PinIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/** Opening an app and placing its shortcut are separate, keyboard-accessible actions. */
export function AppShortcutRow({
  id,
  to,
  label,
  icon: Icon,
  pinned,
  active,
  pinLabel,
  unpinLabel,
  onTogglePin,
  onOpen,
  pinDisabled = false,
  pinDisabledReason,
}: {
  id: string;
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  pinned: boolean;
  active?: boolean;
  pinLabel: string;
  unpinLabel: string;
  onTogglePin: () => void;
  onOpen: () => void;
  pinDisabled?: boolean;
  pinDisabledReason?: string;
}) {
  const pinAction = `${pinned ? unpinLabel : pinLabel} ${label}`;
  return (
    <div
      data-shortcut-row={id}
      className={cn(
        "group/shortcut flex min-w-0 items-center rounded-lg transition-colors hover:bg-foreground/[0.055]",
        active && "bg-foreground/[0.055]",
      )}
    >
      <Link
        to={to}
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Icon className="size-[17px] shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </Link>
      <button
        type="button"
        aria-label={pinAction}
        aria-pressed={pinned}
        title={pinDisabled ? pinDisabledReason : pinAction}
        disabled={pinDisabled}
        onClick={onTogglePin}
        className={cn(
          "mr-1 grid size-8 shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
          pinned
            ? "text-foreground"
            : "text-muted-foreground/60 hover:text-foreground",
        )}
      >
        <PinIcon
          className={cn("size-3.5", pinned && "fill-current")}
          strokeWidth={1.7}
        />
      </button>
    </div>
  );
}
