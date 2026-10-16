import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

export function AdvancedDisclosure({
  id,
  title,
  description,
  children,
  open,
  onOpenChange,
}: {
  id?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [hasOpened, setHasOpened] = useState(Boolean(open));
  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => {
        const expanded = event.currentTarget.open;
        if (expanded) setHasOpened(true);
        onOpenChange?.(expanded);
      }}
      className="group/advanced-item scroll-mt-6 rounded-lg border border-border bg-background/55 px-4 py-3"
    >
      <summary
        aria-label={title}
        className="cursor-pointer list-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </div>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open/advanced-item:rotate-90" />
        </div>
      </summary>
      {(hasOpened || open) && (
        <div className="mt-4 border-t border-border pt-4">{children}</div>
      )}
    </details>
  );
}
