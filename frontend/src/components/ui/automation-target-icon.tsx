import { Globe2Icon, MonitorIcon } from "lucide-react";
import { useState } from "react";
import type { AutomationTarget } from "@/core/computer/api";
import { cn } from "@/lib/utils";

/** Only inline raster icons supplied by the control host; no third-party tracking requests. */
export function AutomationTargetIcon({
  target,
  className,
}: {
  target: AutomationTarget;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const icon = target.icon_url;
  const safe =
    icon &&
    icon !== failedUrl &&
    icon.length < 100_000 &&
    /^data:image\/(?:png|webp|jpeg);base64,[a-z0-9+/=]+$/i.test(icon);
  const Icon = target.kind === "browser_tab" ? Globe2Icon : MonitorIcon;
  return safe ? (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailedUrl(icon)}
      className={cn("size-4 shrink-0 rounded-sm object-contain", className)}
    />
  ) : (
    <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} />
  );
}
