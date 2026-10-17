import { useCallback, useState } from "react";

import {
  E2E_SURPASS_TARGET_SCORE,
  fetchAgentCompetitorScorecard,
  fetchAgentTraceExperienceQualitySummary,
  fetchAgentTracePolicyReviewRuleDrafts,
  fetchAgentTracePromotionAuditSummary,
  fetchAgentTraceReplayGate,
  fetchAgentTraceReviewQueue,
  fetchAgentTraceReviewQueueSummary,
  fetchAgentTraceTrustDenialSummary,
  fetchAutoVerifierMetrics,
  fetchAutomationPolicyRuleDrafts,
  fetchAutomationRadar,
  fetchBrowserDesktopQuality,
  fetchBrowserDesktopRepairRecipeVerifications,
  fetchBrowserDesktopRepairRecipes,
  fetchE2ESurpassCertification,
  fetchOrganizationTopologies,
  fetchOrganizationTopologyLift,
  fetchOrganizationTopologyProposals,
  fetchRepairRouteQuality,
  fetchSubagentFitness,
  fetchTaskRecoveryQueue,
} from "@/core/agent-trace/api";
import type {
  AgentCompetitorScorecard,
  AgentTraceExperienceQualitySummary,
  AgentTracePolicyReviewRuleDrafts,
  AgentTracePromotionAuditSummary,
  AgentTraceReplayGate,
  AgentTraceReviewQueueItem,
  AgentTraceReviewQueueSummary,
  AgentTraceTaskRecoveryQueue,
  AgentTraceTrustDenialSummary,
  AutoVerifierMetricsReport,
  AutomationPolicyRuleDraftsReport,
  AutomationRadarReport,
  BrowserDesktopQualityReport,
  BrowserDesktopRepairRecipeVerificationsReport,
  BrowserDesktopRepairRecipesReport,
  E2ESurpassCertification,
  OrganizationTopology,
  OrganizationTopologyLiftReport,
  OrganizationTopologyProposalsReport,
  RepairRouteQualityReport,
  SubagentFitnessReport,
} from "@/core/agent-trace/api";
import {
  fetchPluginLifecycleHistory,
  fetchPluginPublisherTrust,
  fetchPluginSmokeSummary,
} from "@/core/plugins/api";
import type {
  PluginLifecycleHistory,
  PluginPublisherTrustReport,
  PluginSmokeSummary,
} from "@/core/plugins/types";
import { swallow } from "@/core/utils/log";

import {
  EMPTY_AGENT_SCORECARD,
  EMPTY_AUDIT_SUMMARY,
  EMPTY_AUTOMATION_POLICY_RULE_DRAFTS,
  EMPTY_AUTOMATION_RADAR,
  EMPTY_AUTO_VERIFIER_METRICS,
  EMPTY_BROWSER_DESKTOP_QUALITY,
  EMPTY_BROWSER_DESKTOP_REPAIR_RECIPES,
  EMPTY_BROWSER_DESKTOP_REPAIR_VERIFICATIONS,
  EMPTY_E2E_SURPASS_CERTIFICATION,
  EMPTY_EXPERIENCE_QUALITY,
  EMPTY_PLUGIN_LIFECYCLE_HISTORY,
  EMPTY_PLUGIN_PUBLISHER_TRUST,
  EMPTY_PLUGIN_SMOKE_SUMMARY,
  EMPTY_POLICY_REVIEW_RULE_DRAFTS,
  EMPTY_REPAIR_ROUTE_QUALITY,
  EMPTY_SUBAGENT_FITNESS,
  EMPTY_SUMMARY,
  EMPTY_TASK_RECOVERY_QUEUE,
  EMPTY_TOPOLOGY_LIFT,
  EMPTY_TOPOLOGY_PROPOSALS,
  EMPTY_TRUST_DENIAL_SUMMARY,
} from "./shared";

/**
 * The operator panel's review-queue and governance reports, plus
 * `refreshQueue`, which reloads all of them in one round.
 */
export function useOperatorReports() {
  const [queueItems, setQueueItems] = useState<AgentTraceReviewQueueItem[]>([]);
  const [browserDesktopQueueItems, setBrowserDesktopQueueItems] = useState<
    AgentTraceReviewQueueItem[]
  >([]);
  const [scorecardGapQueueItems, setScorecardGapQueueItems] = useState<
    AgentTraceReviewQueueItem[]
  >([]);
  const [queueSummary, setQueueSummary] =
    useState<AgentTraceReviewQueueSummary>(EMPTY_SUMMARY);
  const [taskRecoveryQueue, setTaskRecoveryQueue] =
    useState<AgentTraceTaskRecoveryQueue>(EMPTY_TASK_RECOVERY_QUEUE);
  const [auditSummary, setAuditSummary] =
    useState<AgentTracePromotionAuditSummary>(EMPTY_AUDIT_SUMMARY);
  const [experienceQuality, setExperienceQuality] =
    useState<AgentTraceExperienceQualitySummary>(EMPTY_EXPERIENCE_QUALITY);
  const [subagentFitness, setSubagentFitness] = useState<SubagentFitnessReport>(
    EMPTY_SUBAGENT_FITNESS,
  );
  const [topologies, setTopologies] = useState<OrganizationTopology[]>([]);
  const [topologyProposals, setTopologyProposals] =
    useState<OrganizationTopologyProposalsReport>(EMPTY_TOPOLOGY_PROPOSALS);
  const [topologyLift, setTopologyLift] =
    useState<OrganizationTopologyLiftReport>(EMPTY_TOPOLOGY_LIFT);
  const [autoVerifierMetrics, setAutoVerifierMetrics] =
    useState<AutoVerifierMetricsReport>(EMPTY_AUTO_VERIFIER_METRICS);
  const [browserDesktopQuality, setBrowserDesktopQuality] =
    useState<BrowserDesktopQualityReport>(EMPTY_BROWSER_DESKTOP_QUALITY);
  const [automationRadar, setAutomationRadar] = useState<AutomationRadarReport>(
    EMPTY_AUTOMATION_RADAR,
  );
  const [automationPolicyRuleDrafts, setAutomationPolicyRuleDrafts] =
    useState<AutomationPolicyRuleDraftsReport>(
      EMPTY_AUTOMATION_POLICY_RULE_DRAFTS,
    );
  const [browserDesktopRepairRecipes, setBrowserDesktopRepairRecipes] =
    useState<BrowserDesktopRepairRecipesReport>(
      EMPTY_BROWSER_DESKTOP_REPAIR_RECIPES,
    );
  const [
    browserDesktopRepairVerifications,
    setBrowserDesktopRepairVerifications,
  ] = useState<BrowserDesktopRepairRecipeVerificationsReport>(
    EMPTY_BROWSER_DESKTOP_REPAIR_VERIFICATIONS,
  );
  const [repairRouteQuality, setRepairRouteQuality] =
    useState<RepairRouteQualityReport>(EMPTY_REPAIR_ROUTE_QUALITY);
  const [pluginSmokeSummary, setPluginSmokeSummary] =
    useState<PluginSmokeSummary>(EMPTY_PLUGIN_SMOKE_SUMMARY);
  const [pluginPublisherTrust, setPluginPublisherTrust] =
    useState<PluginPublisherTrustReport>(EMPTY_PLUGIN_PUBLISHER_TRUST);
  const [pluginLifecycleHistory, setPluginLifecycleHistory] =
    useState<PluginLifecycleHistory>(EMPTY_PLUGIN_LIFECYCLE_HISTORY);
  const [trustDenialSummary, setTrustDenialSummary] =
    useState<AgentTraceTrustDenialSummary>(EMPTY_TRUST_DENIAL_SUMMARY);
  const [policyRuleDrafts, setPolicyRuleDrafts] =
    useState<AgentTracePolicyReviewRuleDrafts>(EMPTY_POLICY_REVIEW_RULE_DRAFTS);
  const [agentScorecard, setAgentScorecard] =
    useState<AgentCompetitorScorecard>(EMPTY_AGENT_SCORECARD);
  const [scorecardError, setScorecardError] = useState<string | null>(null);
  const [e2eCertification, setE2eCertification] =
    useState<E2ESurpassCertification>(EMPTY_E2E_SURPASS_CERTIFICATION);
  const [e2eCertificationError, setE2eCertificationError] = useState<
    string | null
  >(null);
  const [replayGate, setReplayGate] = useState<AgentTraceReplayGate | null>(
    null,
  );

  const refreshQueue = useCallback(async () => {
    const [
      items,
      browserDesktopItems,
      scorecardGapItems,
      summary,
      recoveryQueue,
      gate,
      audit,
      memoryQuality,
      fitness,
      organizationTopologies,
      proposals,
      lift,
      autoVerifier,
      browserDesktopHealth,
      automationRadarReport,
      automationPolicyDrafts,
      browserRepairRecipes,
      browserRepairVerifications,
      repairRoutes,
      pluginSmoke,
      pluginLifecycle,
      publisherTrust,
      trustDenials,
      ruleDrafts,
      scorecardResult,
      e2eCertificationResult,
    ] = await Promise.all([
      fetchAgentTraceReviewQueue(12, 0, { status: "pending" }),
      fetchAgentTraceReviewQueue(6, 0, {
        status: "pending",
        targetBucket: "browser_desktop_replay",
      }),
      fetchAgentTraceReviewQueue(10, 0, {
        status: "pending",
        targetBucket: "scorecard_gap_backlog",
      }),
      fetchAgentTraceReviewQueueSummary(),
      fetchTaskRecoveryQueue({ limit: 8 }),
      fetchAgentTraceReplayGate({ status: "completed" }),
      fetchAgentTracePromotionAuditSummary(),
      fetchAgentTraceExperienceQualitySummary(),
      fetchSubagentFitness(),
      fetchOrganizationTopologies(),
      fetchOrganizationTopologyProposals(),
      fetchOrganizationTopologyLift(),
      fetchAutoVerifierMetrics(),
      fetchBrowserDesktopQuality(),
      fetchAutomationRadar(E2E_SURPASS_TARGET_SCORE),
      fetchAutomationPolicyRuleDrafts(),
      fetchBrowserDesktopRepairRecipes(),
      fetchBrowserDesktopRepairRecipeVerifications(),
      fetchRepairRouteQuality(),
      fetchPluginSmokeSummary(),
      fetchPluginLifecycleHistory(),
      fetchPluginPublisherTrust(),
      fetchAgentTraceTrustDenialSummary(),
      fetchAgentTracePolicyReviewRuleDrafts(),
      fetchAgentCompetitorScorecard(E2E_SURPASS_TARGET_SCORE)
        .then((scorecard) => ({ scorecard, error: null }))
        .catch((err: unknown) => {
          swallow(err);
          return {
            scorecard: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }),
      fetchE2ESurpassCertification(E2E_SURPASS_TARGET_SCORE)
        .then((certification) => ({
          certification,
          error: null,
        }))
        .catch((err: unknown) => {
          swallow(err);
          return {
            certification: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }),
    ]);
    setQueueItems(items);
    setBrowserDesktopQueueItems(browserDesktopItems);
    setScorecardGapQueueItems(scorecardGapItems);
    setQueueSummary(summary);
    setTaskRecoveryQueue(recoveryQueue);
    setReplayGate(gate);
    setAuditSummary(audit);
    setExperienceQuality(memoryQuality);
    setSubagentFitness(fitness);
    setTopologies(organizationTopologies);
    setTopologyProposals(proposals);
    setTopologyLift(lift);
    setAutoVerifierMetrics(autoVerifier);
    setBrowserDesktopQuality(browserDesktopHealth);
    setAutomationRadar(automationRadarReport);
    setAutomationPolicyRuleDrafts(automationPolicyDrafts);
    setBrowserDesktopRepairRecipes(browserRepairRecipes);
    setBrowserDesktopRepairVerifications(browserRepairVerifications);
    setRepairRouteQuality(repairRoutes);
    setPluginSmokeSummary(pluginSmoke);
    setPluginLifecycleHistory(pluginLifecycle);
    setPluginPublisherTrust(publisherTrust);
    setTrustDenialSummary(trustDenials);
    setPolicyRuleDrafts(ruleDrafts);
    if (scorecardResult.scorecard) setAgentScorecard(scorecardResult.scorecard);
    setScorecardError(scorecardResult.error);
    if (e2eCertificationResult.certification) {
      setE2eCertification(e2eCertificationResult.certification);
    }
    setE2eCertificationError(e2eCertificationResult.error);
  }, []);

  return {
    queueItems,
    browserDesktopQueueItems,
    scorecardGapQueueItems,
    queueSummary,
    taskRecoveryQueue,
    auditSummary,
    experienceQuality,
    subagentFitness,
    topologies,
    topologyProposals,
    topologyLift,
    autoVerifierMetrics,
    browserDesktopQuality,
    automationRadar,
    automationPolicyRuleDrafts,
    browserDesktopRepairRecipes,
    browserDesktopRepairVerifications,
    repairRouteQuality,
    pluginSmokeSummary,
    pluginPublisherTrust,
    setPluginPublisherTrust,
    pluginLifecycleHistory,
    trustDenialSummary,
    setTrustDenialSummary,
    policyRuleDrafts,
    agentScorecard,
    scorecardError,
    e2eCertification,
    e2eCertificationError,
    replayGate,
    refreshQueue,
  };
}
