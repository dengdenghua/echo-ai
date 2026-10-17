import {
  fetchAgentTraceTrustDenialSummary,
  installAgentTracePolicyReviewRuleDraft,
  installAutomationPolicyRuleDraft,
  queueAgentScorecardGaps,
  queueBrowserDesktopRepairRecipes,
  queueComputerActivityReplayCase,
  queueLatestBrowserSessionReplayCase,
  queueRepairRoutePromotionCandidates,
  queueReplayEvidenceHint,
  rejectStaleBrowserDesktopReplayArtifacts,
  rerunBrowserDesktopRepairRecipeEvidenceBatch,
} from "@/core/agent-trace/api";
import type {
  AgentCompetitorScorecard,
  AgentTraceTrustDenialSummary,
  ReplayEvidenceHint,
} from "@/core/agent-trace/api";
import { swallow } from "@/core/utils/log";

import {
  formatOperatorCopy,
  readRequestErrorMessage,
  replayEvidenceFromError,
} from "./operator-utils";

/**
 * Operator actions that queue review items or install policy rules from the
 * governance cards (tool safety, browser/desktop replay, repair routes,
 * scorecard gaps, policy drafts), then reload the review queue.
 */
export function useOperatorQueueActions({
  to,
  agentScorecard,
  errorReplayEvidence,
  setBusyId,
  setError,
  setErrorReplayEvidence,
  setLastApplyResult,
  setTrustDenialSummary,
  refreshQueue,
}: {
  to: (source: string) => string;
  agentScorecard: AgentCompetitorScorecard;
  errorReplayEvidence: ReplayEvidenceHint | null;
  setBusyId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setErrorReplayEvidence: (evidence: ReplayEvidenceHint | null) => void;
  setLastApplyResult: (message: string) => void;
  setTrustDenialSummary: (summary: AgentTraceTrustDenialSummary) => void;
  refreshQueue: () => Promise<void>;
}) {
  const onQueueTrustDenials = async () => {
    setBusyId("queue-trust-denials");
    try {
      const next = await fetchAgentTraceTrustDenialSummary(1000, {
        queueRepeated: true,
        minOccurrences: 2,
      });
      setTrustDenialSummary(next);
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueBrowserDesktopReplay = async (kind: "browser" | "desktop") => {
    setBusyId(`queue-${kind}-desktop-replay`);
    try {
      const result =
        kind === "browser"
          ? await queueLatestBrowserSessionReplayCase()
          : await queueComputerActivityReplayCase();
      setLastApplyResult(
        formatOperatorCopy(to, "Queued {count} {kind} replay review item(s).", {
          count: result.queue.created + result.queue.updated,
          kind: to(kind),
        }),
      );
      await refreshQueue();
      setError(null);
      setErrorReplayEvidence(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
      setErrorReplayEvidence(replayEvidenceFromError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueBrowserDesktopRepairRecipes = async () => {
    setBusyId("queue-browser-desktop-repair-recipes");
    try {
      const result = await queueBrowserDesktopRepairRecipes();
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Queued {count} browser/desktop repair recipe item(s).",
          { count: result.created + result.updated },
        ),
      );
      await refreshQueue();
      setError(null);
      setErrorReplayEvidence(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onRejectStaleBrowserDesktopReplayArtifacts = async () => {
    setBusyId("reject-stale-browser-desktop-replay-artifacts");
    try {
      const result = await rejectStaleBrowserDesktopReplayArtifacts();
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Rejected {rejected} stale replay item(s); archived {archived} repair recipe item(s).",
          {
            rejected: result.rejected_count,
            archived: result.archived_recipe_count ?? 0,
          },
        ),
      );
      await refreshQueue();
      setError(null);
      setErrorReplayEvidence(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onRerunBlockedBrowserDesktopRepairRecipes = async () => {
    setBusyId("rerun-browser-desktop-repair-recipes");
    try {
      const result = await rerunBrowserDesktopRepairRecipeEvidenceBatch({
        promoteSourceCases: false,
        actor: "operator_panel",
      });
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Reran {attempted} browser/desktop repair recipe(s): {passed} passed, {failed} failed. Source cases remain operator-gated.",
          {
            attempted: result.attempted,
            passed: result.passed,
            failed: result.failed,
          },
        ),
      );
      await refreshQueue();
      setError(null);
      setErrorReplayEvidence(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueRepairRoutePromotions = async () => {
    setBusyId("queue-repair-route-promotions");
    try {
      const result = await queueRepairRoutePromotionCandidates();
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Queued {count} repair-route promotion review item(s).",
          { count: result.created + result.updated },
        ),
      );
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueErrorReplayEvidence = async () => {
    if (!errorReplayEvidence) return;
    setBusyId("queue-error-replay-evidence");
    try {
      const result = await queueReplayEvidenceHint(errorReplayEvidence);
      setLastApplyResult(
        formatOperatorCopy(to, "Queued {count} replay evidence item(s).", {
          count: result.queue.created + result.queue.updated,
        }),
      );
      await refreshQueue();
      setError(null);
      setErrorReplayEvidence(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueRealScorecardGaps = async () => {
    setBusyId("queue-scorecard-gaps");
    try {
      const result = await queueAgentScorecardGaps({
        targetScore: agentScorecard.target_score,
        limit: 10,
      });
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Queued {count} real scorecard gap review item(s).",
          { count: result.total },
        ),
      );
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onQueueScorecardGap = async (dimensionId: string) => {
    setBusyId(`queue-scorecard-gap:${dimensionId}`);
    try {
      const result = await queueAgentScorecardGaps({
        targetScore: agentScorecard.target_score,
        limit: 1,
        dimensionId,
        reason: "operator scorecard drill-down remediation",
      });
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Queued {count} {dimension} scorecard remediation item(s).",
          { count: result.total, dimension: dimensionId },
        ),
      );
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(readRequestErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onInstallPolicyRuleDraft = async (draftId: string) => {
    setBusyId(`install-policy-rule:${draftId}`);
    try {
      const result = await installAgentTracePolicyReviewRuleDraft(draftId);
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Installed {effect} rule for {tool} · {count} policy rules",
          {
            effect: result.rule.effect,
            tool: result.rule.tool,
            count: result.policy_rule_count,
          },
        ),
      );
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onInstallAutomationPolicyRuleDraft = async (draftId: string) => {
    setBusyId(`install-automation-policy-rule:${draftId}`);
    try {
      const result = await installAutomationPolicyRuleDraft(draftId);
      setLastApplyResult(
        formatOperatorCopy(
          to,
          "Installed {effect} automation rule for {tool} · {count} policy rules",
          {
            effect: result.rule.effect,
            tool: result.rule.tool,
            count: result.policy_rule_count,
          },
        ),
      );
      await refreshQueue();
      setError(null);
    } catch (err) {
      swallow(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return {
    onQueueTrustDenials,
    onQueueBrowserDesktopReplay,
    onQueueBrowserDesktopRepairRecipes,
    onRejectStaleBrowserDesktopReplayArtifacts,
    onRerunBlockedBrowserDesktopRepairRecipes,
    onQueueRepairRoutePromotions,
    onQueueErrorReplayEvidence,
    onQueueRealScorecardGaps,
    onQueueScorecardGap,
    onInstallPolicyRuleDraft,
    onInstallAutomationPolicyRuleDraft,
  };
}
