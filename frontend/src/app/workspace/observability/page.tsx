/* Implementation note. */

import {
  ActivityIcon,
  BrainCircuitIcon,
  GaugeIcon,
  NetworkIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { swallow } from "@/core/utils/log";
import { getBackendBaseURL } from "@/core/config";
import { authHeaders } from "@/core/auth/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { AgentOperatorPanel } from "@/components/workspace/agent-operator-panel";
import { RunReviewPanel } from "@/components/workspace/run-review-panel";
import { OperatorEventsGate } from "@/components/workspace/operator-events-gate";
import { useI18n } from "@/core/i18n/hooks";
import { useGlobalControlPlaneAccess } from "@/core/auth/use-control-plane-access";
import {
  GLOBAL_CONTROL_PLANE_ACCESS_CODE,
  GlobalControlPlaneAccessError,
  globalControlPlaneUrl,
  type ToolEffectsSnapshot,
} from "@/core/observability/api";
import { DiagnosticsContent } from "../diagnostics/page";

import { BlackboardPanelView } from "./blackboard-panel";
import { CostPanelView } from "./cost-panel";
import { HemolymphPanelView } from "./hemolymph-panel";
import { JournalPanel } from "./journal-panel";
import { normalizeObservabilityTab } from "./observability-format";
import type {
  BlackboardListResp,
  BlackboardSnapResp,
  CostSummary,
  HeartbeatState,
  HemolymphResp,
  RegenSummary,
} from "./observability-types";
import { PanelGroup } from "./observability-ui";
import { RegenerationPanelView } from "./regeneration-panel";
import { SwarmPanel } from "./swarm-panel";
import { ToolEffectsPanelView } from "./tool-effects-panel";

// ─── Shared polling helper ───────────────────────────────────
// Every heartbeat-driven panel follows the same shape: fetch JSON
// on an interval, track loading / error, expose a manual-refresh
// button. Abstracting it keeps each panel's render code tight.
function useHeartbeat<T>(
  requestedUrl: string,
  intervalMs: number,
  initial: T,
  options: { globalControlPlane?: boolean } = {},
): HeartbeatState<T> {
  const globalControlPlane = options.globalControlPlane === true;
  // Without the cross-tenant scope the server refuses every global request;
  // do not ask, and report the same forbidden state a 403 would.
  const globalAllowed = useGlobalControlPlaneAccess();
  const blocked = globalControlPlane && !globalAllowed;
  const url = blocked ? "" : requestedUrl;
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const tickRef = useRef(0);
  const pollingStoppedRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!url || pollingStoppedRef.current) {
      setLoading(false);
      return;
    }
    const my = ++tickRef.current;
    try {
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) {
        if (globalControlPlane && r.status === 403) {
          pollingStoppedRef.current = true;
          throw new GlobalControlPlaneAccessError();
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const j = (await r.json()) as T;
      // Drop stale responses if a newer request was started.
      if (tickRef.current !== my) return;
      setData(j);
      setError(null);
      setForbidden(false);
      setLastFetchedAt(Date.now());
    } catch (e) {
      swallow(e);
      if (tickRef.current !== my) return;
      setError(e instanceof Error ? e.message : String(e));
      setForbidden(e instanceof GlobalControlPlaneAccessError);
    } finally {
      if (tickRef.current === my) setLoading(false);
    }
  }, [globalControlPlane, url]);

  useEffect(() => {
    pollingStoppedRef.current = false;
    setForbidden(false);
    void fetchOnce();
    const t = window.setInterval(() => {
      if (!pollingStoppedRef.current) void fetchOnce();
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [fetchOnce, intervalMs]);

  const refresh = useCallback(() => {
    pollingStoppedRef.current = false;
    setForbidden(false);
    void fetchOnce();
  }, [fetchOnce]);

  return blocked
    ? {
        data,
        loading: false,
        error: GLOBAL_CONTROL_PLANE_ACCESS_CODE,
        forbidden: true,
        refresh,
        lastFetchedAt,
      }
    : { data, loading, error, forbidden, refresh, lastFetchedAt };
}

// ═══════════════════════════════════════════════════════════
// PAGE SHELL
// ═══════════════════════════════════════════════════════════

export default function ObservabilityPage({
  initialTab = "runs",
}: {
  initialTab?: string;
}) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeObservabilityTab(searchParams.get("tab") ?? initialTab);
  return (
    <WorkspaceContainer mobileNavigation>
      <WorkspaceBody className="px-0 pb-4 sm:px-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <section className="workspace-panel px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ActivityIcon className="size-5" />
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {t.observabilityPage.pageTitle}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {t.observabilityPage.subtitle}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild className="h-9 rounded-full px-4">
                  <Link to="/workspace/realtime/new">
                    {t.observabilityPage.shell.startTask}
                  </Link>
                </Button>
              </div>
            </div>

          </section>

          <Tabs value={tab} onValueChange={(next) => setSearchParams((current) => {
            const params = new URLSearchParams(current);
            params.set("tab", next);
            return params;
          }, { replace: true })} className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 md:grid-cols-4">
              <TabsTrigger value="overview" className="py-2">
                <ActivityIcon className="mr-1.5 size-3.5" />
                {t.observabilityPage.shell.overviewTab}
              </TabsTrigger>
              <TabsTrigger value="events" className="py-2">
                <NetworkIcon className="mr-1.5 size-3.5" />
                {t.observabilityPage.shell.eventsTab}
              </TabsTrigger>
              <TabsTrigger value="resources" className="py-2">
                <GaugeIcon className="mr-1.5 size-3.5" />
                {t.observabilityPage.shell.resourcesTab}
              </TabsTrigger>
              <TabsTrigger value="system" className="py-2">
                <BrainCircuitIcon className="mr-1.5 size-3.5" />
                {t.observabilityPage.shell.systemTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <div className="space-y-4">
                <section className="workspace-panel px-5 py-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">
                        {t.observabilityPage.shell.overviewTitle}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t.observabilityPage.shell.overviewDescription}
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-full px-4"
                    >
                      <Link to="/workspace/realtime/new">
                        {t.observabilityPage.shell.openNewTask}
                      </Link>
                    </Button>
                  </div>
                </section>
                <AgentOperatorPanel />
              </div>
            </TabsContent>

            <TabsContent value="events" className="mt-4 space-y-4">
              <PanelGroup
                eyebrow={t.observabilityPage.shell.eventsEyebrow}
                title={t.observabilityPage.shell.eventsTitle}
                description={t.observabilityPage.shell.eventsDescription}
              >
                <OperatorEventsGate><RunReviewPanel /><SwarmPanel /></OperatorEventsGate>
                <BlackboardPanel />
                <OperatorEventsGate quiet><JournalPanel /></OperatorEventsGate>
              </PanelGroup>
            </TabsContent>

            <TabsContent value="resources" className="mt-4 space-y-4">
              <PanelGroup
                eyebrow={t.observabilityPage.shell.resourcesEyebrow}
                title={t.observabilityPage.shell.resourcesGroupTitle}
                description={
                  t.observabilityPage.shell.resourcesGroupDescription
                }
              >
                <HemolymphPanel />
                <CostPanel />
              </PanelGroup>
            </TabsContent>

            <TabsContent value="system" className="mt-4 space-y-4">
              <PanelGroup
                eyebrow={t.observabilityPage.shell.systemEyebrow}
                title={t.observabilityPage.shell.systemGroupTitle}
                description={t.observabilityPage.shell.systemGroupDescription}
              >
                <ToolEffectsPanel />
                <RegenerationPanel />
                <DiagnosticsContent />
              </PanelGroup>
            </TabsContent>
          </Tabs>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

// ═══════════════════════════════════════════════════════════
// HEARTBEAT PANELS
// Each panel polls through ``useHeartbeat`` here and renders a
// presentational view from its sibling module. Swarm (panel 1) and
// journal (panel 3) stream SSE themselves: ./swarm-panel, ./journal-panel.
// ═══════════════════════════════════════════════════════════

// PANEL 2 · BLACKBOARD VIEWER — ./blackboard-panel
function BlackboardPanel() {
  const list = useHeartbeat<BlackboardListResp>(
    globalControlPlaneUrl("/api/blackboard"),
    3000,
    { turns: [] },
    { globalControlPlane: true },
  );
  const [selected, setSelected] = useState<string | null>(null);

  // Auto-pick the most recently active turn if none selected.
  useEffect(() => {
    const first = list.data.turns[0];
    if (!selected && first) {
      setSelected(first.turn_id);
    }
  }, [list.data.turns, selected]);

  const snap = useHeartbeat<BlackboardSnapResp | null>(
    selected
      ? globalControlPlaneUrl(
          `/api/blackboard?turn_id=${encodeURIComponent(selected)}`,
        )
      : "",
    2000,
    null,
    { globalControlPlane: true },
  );

  return (
    <BlackboardPanelView
      list={list}
      snap={snap}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

// PANEL 4 · FENCED TOOL EFFECTS — ./tool-effects-panel
const EMPTY_TOOL_EFFECTS: ToolEffectsSnapshot = {
  backend: "disabled",
  shared_across_hosts: false,
  can_authorize_retry: false,
  count: 0,
  state_counts: {},
  receipts: [],
};

export function ToolEffectsPanel() {
  const heartbeat = useHeartbeat<ToolEffectsSnapshot>(
    globalControlPlaneUrl("/api/tool-effects?limit=100"),
    3000,
    EMPTY_TOOL_EFFECTS,
    { globalControlPlane: true },
  );
  return <ToolEffectsPanelView heartbeat={heartbeat} />;
}

// PANEL 4 · REGENERATION SUMMARY — ./regeneration-panel
function RegenerationPanel() {
  const heartbeat = useHeartbeat<RegenSummary | null>(
    globalControlPlaneUrl("/api/regeneration/summary"),
    5000,
    null,
    { globalControlPlane: true },
  );
  return <RegenerationPanelView heartbeat={heartbeat} />;
}

// PANEL 5 · HEMOLYMPH 4-BUCKET METER — ./hemolymph-panel
function HemolymphPanel() {
  const heartbeat = useHeartbeat<HemolymphResp>(
    globalControlPlaneUrl("/api/hemolymph/recent?limit=20"),
    3000,
    { count: 0, max_tracked: 50, snapshots: [] },
    { globalControlPlane: true },
  );
  return <HemolymphPanelView heartbeat={heartbeat} />;
}

// PANEL 6 · COST SUMMARY — ./cost-panel
function CostPanel() {
  const base = getBackendBaseURL();
  const heartbeat = useHeartbeat<CostSummary>(
    `${base}/api/budget/summary?limit=30`,
    3000,
    {
      total_tokens: 0,
      total_usd: 0,
      commit_count: 0,
      task_count: 0,
      tasks: [],
    },
  );
  return <CostPanelView heartbeat={heartbeat} />;
}
