import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  automationTargetFrom,
  OPEN_AUTOMATION_PREVIEW,
  CLOSE_AUTOMATION_INSPECTION,
} from "@/core/automation/references";
import { getRelayStatus } from "@/core/browser/api";
import type { AutomationTarget } from "@/core/computer/api";
import { useI18n } from "@/core/i18n/hooks";
import { AutomationPictureInPicture } from "./automation-picture-in-picture";

/** Inspect a historical app reference without retargeting subsequent agent actions. */
export function AutomationPreviewHost({ threadId }: { threadId: string }) {
  const [target, setTarget] = useState<AutomationTarget | null>(null);
  const { t } = useI18n();
  useEffect(() => {
    setTarget(null);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.threadId === threadId)
        setTarget(automationTargetFrom(detail));
    };
    window.addEventListener(OPEN_AUTOMATION_PREVIEW, handler);
    const close = (event: Event) => {
      if ((event as CustomEvent).detail?.threadId === threadId) setTarget(null);
    };
    window.addEventListener(CLOSE_AUTOMATION_INSPECTION, close);
    return () => {
      window.removeEventListener(OPEN_AUTOMATION_PREVIEW, handler);
      window.removeEventListener(CLOSE_AUTOMATION_INSPECTION, close);
    };
  }, [threadId]);
  const relay = useQuery({
    queryKey: ["automation-inspection-relay"],
    queryFn: getRelayStatus,
    enabled: target?.kind === "browser_tab",
    staleTime: 5000,
    retry: false,
  });
  return target ? (
    <AutomationPictureInPicture
      threadId={threadId}
      target={target}
      open
      active={false}
      paused={false}
      relayConnected={Boolean(relay.data?.connected)}
      stateLabel={t.common.preview}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
    />
  ) : null;
}
