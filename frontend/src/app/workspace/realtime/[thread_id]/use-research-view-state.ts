import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { DeepResearchComposerOptions } from "@/components/workspace/chat-input-box";
import { startDeepResearch, type ResearchJob } from "@/core/research/api";
import { swallow } from "@/core/utils/log";

import {
  emptyThreadResearchViewState,
  extractResearchUrls,
  type ThreadResearchViewState,
} from "./page-utils";

/**
 * Deep-research panel state, scoped to the conversation that started it.
 *
 * The page component is reused across route changes, so every write is
 * re-keyed to the thread that is active at write time and the whole view is
 * replaced when the thread changes.
 */
export function useResearchViewState(
  threadId: string,
  activeThreadIdRef: RefObject<string>,
) {
  const [researchViewState, setResearchViewState] =
    useState<ThreadResearchViewState>(() =>
      emptyThreadResearchViewState(threadId),
    );
  const currentResearchView =
    researchViewState.threadId === threadId
      ? researchViewState
      : emptyThreadResearchViewState(threadId);
  const researchJob = currentResearchView.job;
  const researchLoading = currentResearchView.loading;
  const researchError = currentResearchView.error;
  const showResearch = currentResearchView.visible;
  const updateResearchView = useCallback(
    (patch: Partial<Omit<ThreadResearchViewState, "threadId">>) => {
      const ownerThreadId = activeThreadIdRef.current;
      setResearchViewState((current) => ({
        ...(current.threadId === ownerThreadId
          ? current
          : emptyThreadResearchViewState(ownerThreadId)),
        ...patch,
      }));
    },
    [activeThreadIdRef],
  );
  const setResearchJob = useCallback(
    (job: ResearchJob | null) => updateResearchView({ job }),
    [updateResearchView],
  );
  const setResearchLoading = useCallback(
    (loading: boolean) => updateResearchView({ loading }),
    [updateResearchView],
  );
  const setResearchError = useCallback(
    (error: string | null) => updateResearchView({ error }),
    [updateResearchView],
  );
  const setShowResearch = useCallback(
    (visible: boolean) => updateResearchView({ visible }),
    [updateResearchView],
  );
  const researchOperationRef = useRef<object | null>(null);
  useEffect(() => {
    // Route changes reuse this component. Invalidate any request started by
    // the previous conversation and replace its transient research UI state,
    // so returning later cannot resurrect a permanently loading panel.
    researchOperationRef.current = null;
    setResearchViewState((current) =>
      current.threadId === threadId
        ? current
        : emptyThreadResearchViewState(threadId),
    );
  }, [threadId]);

  return {
    researchJob,
    researchLoading,
    researchError,
    showResearch,
    setResearchJob,
    setResearchLoading,
    setResearchError,
    setShowResearch,
    researchOperationRef,
  };
}

interface DeepResearchLauncherInput {
  threadId: string;
  activeThreadIdRef: RefObject<string>;
  researchOperationRef: RefObject<object | null>;
  effectiveAgentId: string;
  researchLoading: boolean;
  readyForMutations: boolean;
  closeSpecialUtilityPanels: () => void;
  setResearchJob: (job: ResearchJob | null) => void;
  setResearchLoading: (loading: boolean) => void;
  setResearchError: (error: string | null) => void;
  setShowResearch: (visible: boolean) => void;
  setShowAgentPlan: (open: boolean) => void;
  setShowResearchHistory: (open: boolean) => void;
}

/** Starts a deep-research job from the composer and owns its stale-result guards. */
export function useDeepResearchLauncher({
  threadId,
  activeThreadIdRef,
  researchOperationRef,
  effectiveAgentId,
  researchLoading,
  readyForMutations,
  closeSpecialUtilityPanels,
  setResearchJob,
  setResearchLoading,
  setResearchError,
  setShowResearch,
  setShowAgentPlan,
  setShowResearchHistory,
}: DeepResearchLauncherInput) {
  return useCallback(
    async (topic: string, options?: DeepResearchComposerOptions) => {
      const extracted = extractResearchUrls(topic);
      const clean = extracted.topic.trim();
      if (!clean || researchLoading || !readyForMutations) return false;
      const requestThreadId = threadId;
      const operation = {};
      researchOperationRef.current = operation;
      const urls = Array.from(
        new Set([
          ...extracted.urls,
          ...(options?.urls ?? []),
          ...(options?.materials ?? [])
            .map((material) => material.url)
            .filter((url): url is string => !!url),
        ]),
      );
      closeSpecialUtilityPanels();
      setResearchLoading(true);
      setResearchError(null);
      setShowAgentPlan(false);
      setShowResearch(true);
      setShowResearchHistory(false);
      try {
        const job = await startDeepResearch({
          topic: clean,
          thread_id: threadId,
          lead_agent_name: effectiveAgentId,
          depth: "deep",
          max_subagents: options?.maxSubagents,
          max_searches: options?.maxSearches ?? 274,
          include_thread_uploads: true,
          prefetch_sources: true,
          materials: options?.materials ?? [],
          urls,
          roles: options?.roles,
          source_kinds: options?.sourceKinds ?? [
            "web",
            "news",
            "academic",
            "company_site",
            "ecommerce",
            "social",
            "forum",
            "provided_url",
            "uploaded_file",
          ],
        });
        if (
          researchOperationRef.current !== operation ||
          activeThreadIdRef.current !== requestThreadId
        ) {
          return false;
        }
        setResearchJob(job);
        return true;
      } catch (err) {
        swallow(err);
        if (
          researchOperationRef.current !== operation ||
          activeThreadIdRef.current !== requestThreadId
        ) {
          return false;
        }
        setResearchError(
          err instanceof Error ? err.message : "Failed to start agent run",
        );
        return false;
      } finally {
        if (
          researchOperationRef.current === operation &&
          activeThreadIdRef.current === requestThreadId
        ) {
          researchOperationRef.current = null;
          setResearchLoading(false);
        }
      }
    },
    [
      activeThreadIdRef,
      closeSpecialUtilityPanels,
      effectiveAgentId,
      readyForMutations,
      researchLoading,
      researchOperationRef,
      setResearchError,
      setResearchJob,
      setResearchLoading,
      setShowAgentPlan,
      setShowResearch,
      setShowResearchHistory,
      threadId,
    ],
  );
}
