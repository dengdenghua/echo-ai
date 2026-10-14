import type { ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  FlagIcon,
  TimerIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Health } from "@/core/projects/cockpit-types";

export function healthIcon(health: Health) {
  if (health === "on_track") return <CheckCircle2Icon className="size-3.5" />;
  if (health === "at_risk") return <AlertTriangleIcon className="size-3.5" />;
  if (health === "overdue") return <TimerIcon className="size-3.5" />;
  if (health === "blocked") return <FlagIcon className="size-3.5" />;
  return <CircleIcon className="size-3.5" />;
}

export function MetricCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: "danger" | "warn" | "ok";
}) {
  const toneClass =
    tone === "danger"
      ? "text-warning"
      : tone === "warn"
        ? "text-warning"
        : tone === "ok"
          ? "text-core"
          : "";
  return (
    <Card className="bg-card/60">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`mt-0.5 truncate text-lg font-semibold ${toneClass}`}>
            {value}
          </div>
          {sub && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {sub}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** 空态里的「下一步该做什么」提示 —— 不再只写「暂无 X。」 */
export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
      {text}
    </div>
  );
}
