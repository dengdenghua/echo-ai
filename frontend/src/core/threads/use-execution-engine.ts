import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { coderQueryKeys, getCoderModelProfile } from "@/core/coder/api";
import { apiGet } from "@/core/api/request";
import type { EngineCapabilityChecks } from "@/core/agents/engine-capability-checks";
import { useModels } from "@/core/models/hooks";
import {
  hasAnsweringModel,
  opencodeServesSelection,
} from "@/core/models/readiness";
import {
  canAnswerOn,
  defaultExecutionEngine,
  type EngineReadiness,
} from "@/core/realtime/default-engine";
import {
  executionEnginePreference,
  previewExecutionEngine,
  type ExecutionEnginePreference,
} from "@/core/realtime/execution-policy";

function readPreference(key: string): ExecutionEnginePreference | null {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === null ? null : executionEnginePreference(saved);
  } catch {
    return null;
  }
}

export function useExecutionEngine({
  threadId,
  parentThreadId,
  principal,
  roleBackend,
  codingTask,
  orchestrated,
  modelName,
  enabled,
}: {
  threadId: string;
  parentThreadId?: string;
  principal: string;
  roleBackend?: unknown;
  codingTask: boolean;
  orchestrated: boolean;
  nativeTopology?: boolean;
  /** The conversation's model pick; OpenCode needs one it can serve. */
  modelName?: string | null;
  enabled: boolean;
}) {
  const storageKey = `echo:execution-engine:${principal}:${threadId}`;
  // The person's last explicit pick, offered to their next new conversation.
  const lastChoiceKey = `echo:execution-engine-last:${principal}`;
  const parentStorageKey = parentThreadId
    ? `echo:execution-engine:${principal}:${parentThreadId}`
    : null;
  const inherited = parentStorageKey ? readPreference(parentStorageKey) : null;
  const [selection, setSelection] = useState(() => ({
    key: storageKey,
    value: readPreference(storageKey) ?? inherited,
  }));
  const [lastChoice, setLastChoice] = useState(() => ({
    key: lastChoiceKey,
    value: readPreference(lastChoiceKey),
  }));
  useEffect(() => {
    const saved = readPreference(storageKey);
    const parent = parentStorageKey ? readPreference(parentStorageKey) : null;
    setSelection({ key: storageKey, value: saved ?? parent });
    setLastChoice({ key: lastChoiceKey, value: readPreference(lastChoiceKey) });
    if (saved === null && parent !== null) {
      try {
        window.localStorage.setItem(storageKey, parent);
      } catch {
        /* Optional storage. */
      }
    }
  }, [storageKey, parentStorageKey, lastChoiceKey]);
  const opencode = useQuery({
    queryKey: ["opencode-status", principal],
    queryFn: async ({ signal }) =>
      (await apiGet("/api/config/opencode/status", {
        signal,
        errorMessage: () => "OpenCode status unavailable",
      })) as {
        available: boolean;
        reason: string | null;
        reason_code?: string;
        capability_checks?: EngineCapabilityChecks;
      },
    enabled,
    staleTime: 30_000,
  });
  const profile = useQuery({
    queryKey: coderQueryKeys(principal).profile,
    queryFn: ({ signal }) => getCoderModelProfile(signal),
    enabled,
    staleTime: 30_000,
  });
  const catalog = useModels({ enabled });
  // The slim desktop installer has no OpenCode until the store installs it;
  // Auto then runs on Echo's own models instead of failing the first message.
  const opencodeMissing = opencode.data?.reason_code === "not_installed";
  const catalogKnown = !catalog.isLoading && !catalog.error;
  const opencodeHasModel = opencodeServesSelection(catalog.models, modelName);
  const codexAvailable = profile.data?.execution_available === true;
  const readiness: EngineReadiness = {
    known: opencode.isSuccess && !profile.isPending && catalogKnown,
    opencodeMissing,
    opencodeReady: opencode.data?.available === true && opencodeHasModel,
    codexReady: codexAvailable,
    echoReady: !catalogKnown || hasAnsweringModel(catalog.models),
  };
  const savedPreference =
    (selection.key === storageKey
      ? selection.value
      : readPreference(storageKey)) ?? inherited;
  // Default synchronously: waiting for readiness would briefly submit Auto
  // and could send an early request to another provider. Once readiness
  // arrives, an unpicked conversation starts on an engine that can answer;
  // a pick the person made is never replaced.
  const preference =
    savedPreference ??
    defaultExecutionEngine({
      independent:
        enabled && !orchestrated && roleBackend !== "codex_app_server",
      lastChoice:
        lastChoice.key === lastChoiceKey
          ? lastChoice.value
          : readPreference(lastChoiceKey),
      readiness,
    });
  const rememberForThread = useCallback(
    (id: string) => {
      setSelection({ key: storageKey, value: preference });
      try {
        window.localStorage.setItem(
          `echo:execution-engine:${principal}:${id}`,
          preference,
        );
      } catch {
        /* Storage is optional. */
      }
    },
    [principal, preference, storageKey],
  );
  const setPreference = useCallback(
    (value: ExecutionEnginePreference) => {
      setSelection({ key: storageKey, value });
      setLastChoice({ key: lastChoiceKey, value });
      try {
        window.localStorage.setItem(storageKey, value);
        window.localStorage.setItem(lastChoiceKey, value);
      } catch {
        /* Storage is optional. */
      }
    },
    [storageKey, lastChoiceKey],
  );
  const engine = previewExecutionEngine({
    preference,
    roleBackend,
    codingTask,
    orchestrated,
    codexAvailable,
    opencodeMissing,
    opencodeNoModel:
      opencode.data?.available === true && catalogKnown && !opencodeHasModel,
    echoReady: readiness.echoReady,
  });
  return {
    preference,
    setPreference,
    rememberForThread,
    engine,
    /** Whether the engine this conversation runs on can answer; null while
     * that is still being checked, false when it could not be checked. */
    engineReady: readiness.known
      ? canAnswerOn(engine, readiness)
      : enabled &&
          (opencode.isPending || profile.isPending || catalog.isLoading)
        ? null
        : false,
    codexAvailable,
    /** The model Codex turns run on, as the composer's Codex control shows it. */
    codexModel:
      profile.data?.selected_model || profile.data?.effective_model || null,
    codexCapabilityChecks: profile.data?.capability_checks,
    opencodeCapabilityChecks: opencode.data?.capability_checks,
    opencodeAvailable: opencode.data?.available === true,
    opencodeUnavailableReason: opencode.data?.reason ?? null,
    /** Readiness is still loading — not a failure, so nothing is flagged yet. */
    engineChecking: profile.isPending || opencode.isPending,
    codexUnavailableReason:
      profile.data?.execution_unavailable_reason ??
      (profile.isError
        ? "configuration_unavailable"
        : profile.isPending
          ? "checking"
          : null),
  };
}
