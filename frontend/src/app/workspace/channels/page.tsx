/* Implementation note. */
import { swallow } from "@/core/utils/log";
import { getBackendBaseURL } from "@/core/config";
import { authHeaders, jsonAuthHeaders } from "@/core/auth/api";
import { requireArray, serviceErrorMessage } from "@/core/utils/service-error";
import { MessageCircleIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { ChannelCredentialDialog } from "@/components/workspace/channel-credential-dialog";
import { ChannelPairingsSheet } from "@/components/workspace/channel-pairings-sheet";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ChannelAssignDialog } from "./channel-assign-dialog";
import { ChannelCard } from "./channel-card";
import {
  CATEGORY_ORDER,
  PLATFORM_CATEGORIES,
  PLATFORM_CATEGORY_MAP,
  type AgentLite,
  type ChannelFilter,
  type ChannelRow,
  type GroupLite,
} from "./channels-model";

export default function ChannelsPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [assignQuery, setAssignQuery] = useState("");
  /* Implementation note. */
  const [assigningId, setAssigningId] = useState<string | null>(null);
  /* Implementation note. */
  const [credPlatform, setCredPlatform] = useState<string | null>(null);
  /* Implementation note. */
  const [pairingsForId, setPairingsForId] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);

  // Implementation note.
  const loadAll = async () => {
    setLoading(true);
    try {
      const [chRes, agRes, groupRes] = await Promise.all([
        fetch(`${getBackendBaseURL()}/api/channels`, {
          headers: authHeaders(),
        }),
        fetch(`${getBackendBaseURL()}/api/agents`, { headers: authHeaders() }),
        fetch(`${getBackendBaseURL()}/api/groups`, { headers: authHeaders() }),
      ]);
      if (!chRes.ok)
        throw new Error(`Failed to load channels: ${chRes.status}`);
      const ch = requireArray<ChannelRow>(await chRes.json(), "渠道列表");
      setRows(ch);
      if (agRes.ok) {
        const ag = requireArray<AgentLite>(await agRes.json(), "角色列表");
        setAgents(
          ag
            .map((agent) => ({ ...agent, id: agent.id || agent.name || "" }))
            .filter((agent) => agent.id),
        );
      }
      if (groupRes.ok) {
        setGroups(requireArray<GroupLite>(await groupRes.json(), "团队列表"));
      }
      setError(null);
    } catch (e) {
      swallow(e);
      setError(serviceErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const assignRow = rows.find((r) => r.channel_id === assigningId);

  async function assignAgent(channelId: string, agentId: string) {
    try {
      const r = await fetch(
        `${getBackendBaseURL()}/api/channels/${channelId}/assistant`,
        {
          method: "POST",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({ agent_id: agentId }),
        },
      );
      if (!r.ok) {
        const detail = await r.text();
        throw new Error(detail || r.statusText);
      }
      toast.success(t.channels.toastAgentBound);
      setAssigningId(null);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.channels.toastBindFailed);
    }
  }

  async function assignGroup(channelId: string, groupId: string) {
    try {
      const response = await fetch(
        `${getBackendBaseURL()}/api/channels/${channelId}/assistant`,
        {
          method: "POST",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({ group_id: groupId }),
        },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || response.statusText);
      }
      toast.success(t.channels.toastTeamBound);
      setAssigningId(null);
      await loadAll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.channels.toastBindFailed,
      );
    }
  }

  async function unassignAgent(channelId: string) {
    if (
      !(await confirm({
        title: t.channels.unassignConfirmTitle,
        description: t.channels.unassignConfirmDescription,
        confirmLabel: t.channels.unassignCurrent,
      }))
    )
      return;
    try {
      const r = await fetch(
        `${getBackendBaseURL()}/api/channels/${channelId}/assistant`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!r.ok) throw new Error(r.statusText);
      toast.success(t.channels.toastAgentUnbound);
      await loadAll();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t.channels.toastUnbindFailed,
      );
    }
  }

  async function probeChannel(channelId: string) {
    setProbingId(channelId);
    try {
      const response = await fetch(
        `${getBackendBaseURL()}/api/channels/${channelId}/diagnostics/probe`,
        { method: "POST", headers: authHeaders() },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || response.statusText);
      }
      const operations = (await response.json()) as ChannelRow["operations"];
      setRows((current) =>
        current.map((row) =>
          row.channel_id === channelId ? { ...row, operations } : row,
        ),
      );
      if (operations.health_status === "healthy") {
        toast.success(t.channels.healthCheckPassed);
      } else {
        toast.error(operations.last_error || t.channels.healthCheckFailed);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.channels.healthCheckFailed,
      );
    } finally {
      setProbingId(null);
    }
  }

  const connectedCount = useMemo(
    () => rows.filter((r) => r.connected).length,
    [rows],
  );
  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "connected" && !row.connected) return false;
      if (filter === "unlinked" && row.connected) return false;
      if (!term) return true;
      const assignedAgent = agents.find((a) => a.id === row.assigned_agent_id);
      const assignedGroup = groups.find(
        (group) => group.group_id === row.assigned_group_id,
      );
      return [
        row.display_name,
        row.description,
        row.platform,
        row.type,
        row.channel_id,
        row.assigned_agent_id ?? "",
        assignedAgent?.display_name ?? "",
        row.assigned_group_id ?? "",
        assignedGroup?.display_name ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [agents, filter, groups, query, rows]);

  const channelSections = useMemo(() => {
    const grouped: Record<string, ChannelRow[]> = {};
    const otherRows: ChannelRow[] = [];
    for (const row of filteredRows) {
      const cat = PLATFORM_CATEGORY_MAP[row.platform];
      if (cat) {
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(row);
      } else {
        otherRows.push(row);
      }
    }
    const sections: {
      key: string;
      label: string;
      items: ChannelRow[];
    }[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (grouped[cat] && grouped[cat].length > 0) {
        sections.push({
          key: cat,
          label: PLATFORM_CATEGORIES[cat] ?? cat,
          items: grouped[cat],
        });
      }
    }
    if (otherRows.length > 0) {
      sections.push({
        key: "other",
        label: t.channels.categoryOther,
        items: otherRows,
      });
    }
    return sections;
  }, [filteredRows, t.channels.categoryOther]);

  return (
    <WorkspaceContainer
      mobileNavigation={!embedded}
      className={embedded ? "h-full min-h-0 !px-0 !pb-0" : undefined}
      style={embedded ? { height: "100%" } : undefined}
    >
      <WorkspaceBody className="px-4 pb-4">
        <div className="ui-density-stack mx-auto flex w-full max-w-6xl flex-col">
          {confirmDialog}
          {/* Implementation note. */}
          <section className="workspace-panel ui-density-panel">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
                    <MessageCircleIcon className="size-5" />
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">
                      {t.channels.title}
                    </h1>
                  </div>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t.channels.pageDescription}
                  <span className="ml-1 text-muted-foreground">
                    {t.channels.localDataNote}
                  </span>
                </p>
              </div>

              <div className="grid min-w-[220px] grid-cols-2 gap-2 tabular-nums">
                <div className="rounded-lg border border-border-default bg-background/62 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {t.channels.channelCount(rows.length)}
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    {rows.length}
                  </div>
                </div>
                <div className="rounded-lg border border-success/20 bg-success/50/[0.06] px-3 py-2">
                  <div className="flex items-center gap-1 text-xs text-success">
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        connectedCount > 0
                          ? "bg-success"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    {t.channels.connectedCount(connectedCount)}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-success">
                    {connectedCount}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {loading && (
            <LoadingState
              title={t.channels.loading}
              variant="skeleton"
              className="workspace-panel p-5"
            />
          )}

          {error && (
            <ErrorState
              title={t.channels.loadFailed}
              detail={error}
              actionLabel={t.channels.retry}
              onAction={() => void loadAll()}
              className="workspace-panel"
            />
          )}

          {!loading && !error && rows.length === 0 && (
            <Empty className="workspace-panel min-h-[260px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircleIcon />
                </EmptyMedia>
                <EmptyTitle>{t.channels.noRegistered}</EmptyTitle>
                <EmptyDescription>
                  {t.channels.noRegisteredDescription}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {!loading && !error && rows.length > 0 && (
            <>
              <section className="workspace-panel flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t.channels.searchPlaceholder}
                    className="h-10 rounded-lg pl-9"
                  />
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-1 rounded-lg border border-border-default bg-muted/25 p-1">
                  {[
                    { value: "all", label: t.channels.filterAll },
                    { value: "connected", label: t.channels.filterConnected },
                    { value: "unlinked", label: t.channels.filterUnlinked },
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFilter(item.value as ChannelFilter)}
                      className={cn(
                        "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
                        filter === item.value
                          ? "bg-background text-foreground shadow-[var(--shadow-xs)]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              {channelSections.length === 0 ? (
                <Empty className="workspace-panel min-h-[240px]">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SearchIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t.channels.noSearchResults}</EmptyTitle>
                    <EmptyDescription>
                      {t.channels.noSearchResultsDescription}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                channelSections.map((section) => (
                  <div key={section.key}>
                    <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                      {section.label}
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {section.items.map((row, index) => (
                        <ChannelCard
                          key={row.channel_id || `${row.platform}-${index}`}
                          row={row}
                          agents={agents}
                          groups={groups}
                          onRequestAssign={() => setAssigningId(row.channel_id)}
                          onRequestCredential={() =>
                            setCredPlatform(row.platform)
                          }
                          onRequestPairings={() =>
                            setPairingsForId(row.channel_id)
                          }
                          onRequestHealthCheck={() =>
                            void probeChannel(row.channel_id)
                          }
                          probing={probingId === row.channel_id}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </WorkspaceBody>

      {/* Implementation note. */}
      {pairingsForId &&
        (() => {
          const row = rows.find((r) => r.channel_id === pairingsForId);
          if (!row) return null;
          return (
            <ChannelPairingsSheet
              open={true}
              onOpenChange={(o) => !o && setPairingsForId(null)}
              channelId={pairingsForId}
              displayName={row.display_name}
            />
          );
        })()}

      {/* Implementation note. */}
      {credPlatform &&
        (() => {
          const row = rows.find((r) => r.platform === credPlatform);
          if (!row) return null;
          return (
            <ChannelCredentialDialog
              open={true}
              onOpenChange={(o) => !o && setCredPlatform(null)}
              platform={credPlatform}
              displayName={row.display_name}
              helpUrl={row.help_url}
              hasExisting={row.connected}
              onSaved={() => void loadAll()}
              onDeleted={() => void loadAll()}
            />
          );
        })()}

      {/* Implementation note. */}
      <ChannelAssignDialog
        open={!!assigningId}
        onOpenChange={(open) => {
          if (!open) {
            setAssigningId(null);
            setAssignQuery("");
          }
        }}
        assignRow={assignRow}
        agents={agents}
        groups={groups}
        assignQuery={assignQuery}
        onAssignQueryChange={setAssignQuery}
        onAssignGroup={(groupId) => {
          if (assigningId) void assignGroup(assigningId, groupId);
        }}
        onAssignAgent={(agentId) => {
          if (assigningId) void assignAgent(assigningId, agentId);
        }}
        onUnassign={(channelId) => {
          void unassignAgent(channelId);
          setAssigningId(null);
        }}
      />
    </WorkspaceContainer>
  );
}
