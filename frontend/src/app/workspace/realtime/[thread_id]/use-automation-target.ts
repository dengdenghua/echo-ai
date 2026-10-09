import { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadAutomationTarget,
  saveAutomationTarget,
} from "@/core/automation/target";
import { automationTargetFrom } from "@/core/automation/references";
import type { AutomationTarget } from "@/core/computer/api";

import type { RealtimeToolEvents, StateSetter } from "./realtime-page-types";

/**
 * The browser tab / desktop window this conversation automates, persisted per
 * thread so the runtime receives a stable structured reference.
 */
export function useAutomationTarget(threadId: string) {
  const [automationTarget, setAutomationTarget] =
    useState<AutomationTarget | null>(() => loadAutomationTarget(threadId));
  const handleAutomationTargetChange = useCallback(
    (target: AutomationTarget | null) => {
      setAutomationTarget(target);
      saveAutomationTarget(threadId, target);
    },
    [threadId],
  );
  useEffect(() => {
    setAutomationTarget(loadAutomationTarget(threadId));
  }, [threadId]);

  return { automationTarget, setAutomationTarget, handleAutomationTargetChange };
}

/**
 * While a turn is running, follow the target that the latest computer/browser
 * tool call actually touched. Returns that latest automation tool event.
 */
export function useObservedAutomationTarget({
  lastTurnToolEvents,
  embeddedDesignChat,
  isLoading,
  setAutomationTarget,
}: {
  lastTurnToolEvents: RealtimeToolEvents;
  embeddedDesignChat: boolean;
  isLoading: boolean;
  setAutomationTarget: StateSetter<AutomationTarget | null>;
}) {
  const latestAutomationEvent = [...lastTurnToolEvents].reverse().find(event =>
    /^(?:computer_|browser_|screen_|mouse_|keyboard_)/.test(event.name));
  const observedAutomationTarget = useMemo(() => automationTargetFrom(latestAutomationEvent?.output) || automationTargetFrom(latestAutomationEvent?.input), [latestAutomationEvent?.output, latestAutomationEvent?.input]);
  useEffect(() => {
    if (observedAutomationTarget && !embeddedDesignChat && isLoading) setAutomationTarget(observedAutomationTarget);
  }, [observedAutomationTarget, embeddedDesignChat, isLoading, setAutomationTarget]);

  return latestAutomationEvent;
}
