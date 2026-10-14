import { useId } from "react";

import { Switch } from "@/components/ui/switch";
import {
  setStreamingDebugEnabled,
  useStreamingDebugEnabled,
} from "@/core/observability/streaming-debug-flag";

/** Opt-in switch for the developer-only floating streaming debugger. */
export function StreamingDebugSetting({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const enabled = useStreamingDebugEnabled();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
      <div className="min-w-0 space-y-1">
        <h3 id={labelId} className="text-sm font-medium">
          {title}
        </h3>
        <p
          id={descriptionId}
          className="text-xs leading-5 text-muted-foreground"
        >
          {description}
        </p>
      </div>
      <Switch
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        checked={enabled}
        onCheckedChange={(checked) => setStreamingDebugEnabled(checked)}
      />
    </div>
  );
}
