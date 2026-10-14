import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** One pill in the assistant panel's page-tools row. */
export function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-mini text-foreground disabled:opacity-50",
        "bg-white/10",
      )}
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}
