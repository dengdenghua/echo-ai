import { FlaskConicalIcon, PackagePlusIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";
import { RoutedWebLink } from "@/components/ui/routed-web-link";

import type {
  EvolutionApi,
  McpProposal,
  ModelProposal,
  SkillProposal,
} from "./types";
import { Card, EmptyState, Pill } from "./ui";

// ---------------------------------------------------------------------------
// Section: Skill proposals (intel)
// ---------------------------------------------------------------------------

export function SkillProposalsSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<SkillProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SkillProposal[]>(
        "/api/intel-evolution/skills/proposals?status=pending",
      );
      setRows(data);
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (name: string, approve: boolean) => {
      setBusy(name);
      try {
        await api.post(
          `/api/intel-evolution/skills/proposals/${approve ? "approve" : "reject"}`,
          { name, reason: approve ? "approved" : "rejected via UI" },
        );
        await load();
      } catch (e) {
        swallow(e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [api, load],
  );

  return (
    <Card
      title={t.evolutionControl.skillProposals.cardTitle}
      icon={<SparklesIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
    >
      {!rows.length && !loading && (
        <EmptyState text={t.evolutionControl.skillProposals.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map((p) => (
          <div
            key={p.name}
            className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{p.name}</span>
                {p.topic && <Pill label={p.topic} tone="info" />}
              </div>
              {p.source_url && (
                <RoutedWebLink
                  href={p.source_url}
                  openTargetSource="evolution-source"
                  className="text-xs text-primary underline underline-offset-2"
                >
                  {p.source_url}
                </RoutedWebLink>
              )}
              <span className="text-xs text-muted-foreground">
                {p.created_at}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy === p.name}
                onClick={() => decide(p.name, true)}
                className="rounded-lg bg-success/10 px-3 py-1 text-xs text-success hover:bg-success/20 disabled:opacity-50 dark:text-success"
              >
                {t.evolutionControl.skillProposals.approve}
              </button>
              <button
                type="button"
                disabled={busy === p.name}
                onClick={() => decide(p.name, false)}
                className="rounded-lg bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50 dark:text-destructive"
              >
                {t.evolutionControl.skillProposals.reject}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Model proposals
// ---------------------------------------------------------------------------

export function ModelProposalsSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ModelProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ModelProposal[]>(
        "/api/intel-evolution/models/proposals",
      );
      setRows(data);
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const runBenchmarks = useCallback(async () => {
    setRunning(true);
    try {
      await api.post("/api/intel-evolution/models/benchmarks/run", {});
      await load();
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [api, load]);

  return (
    <Card
      title={t.evolutionControl.models.cardTitle}
      icon={<FlaskConicalIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
      headerRight={
        <button
          type="button"
          disabled={running}
          onClick={runBenchmarks}
          className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {running
            ? t.evolutionControl.models.runningBenchmarks
            : t.evolutionControl.models.runBenchmarks}
        </button>
      }
    >
      {!rows.length && !loading && (
        <EmptyState text={t.evolutionControl.models.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map((p) => (
          <div key={p.model_label} className="py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs">{p.model_label}</span>
              <Pill
                label={p.status}
                tone={
                  p.status === "promoted"
                    ? "ok"
                    : p.status === "rejected"
                      ? "bad"
                      : "muted"
                }
              />
            </div>
            {p.benchmark_notes && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t.evolutionControl.models.benchmarkNotes}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs">
                  {p.benchmark_notes}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: MCP proposals
// ---------------------------------------------------------------------------

export function McpProposalsSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<McpProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<McpProposal[]>(
        "/api/intel-evolution/mcp/proposals",
      );
      setRows(data);
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const vetAll = useCallback(async () => {
    try {
      await api.post("/api/intel-evolution/mcp/proposals/vet", {});
      await load();
    } catch (e) {
      swallow(e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, load]);

  const install = useCallback(
    async (server_name: string) => {
      setBusy(server_name);
      try {
        await api.post("/api/intel-evolution/mcp/proposals/install", {
          server_name,
        });
        await load();
      } catch (e) {
        swallow(e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [api, load],
  );

  return (
    <Card
      title={t.evolutionControl.mcp.cardTitle}
      icon={<PackagePlusIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
      headerRight={
        <button
          type="button"
          onClick={vetAll}
          disabled={
            loading ||
            Boolean(busy) ||
            !rows.some((row) => ["pending", "pending_vet"].includes(row.status))
          }
          className="rounded-lg border border-border-default px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.evolutionControl.mcp.vetAll}
        </button>
      }
    >
      {!rows.length && !loading && (
        <EmptyState text={t.evolutionControl.mcp.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map((p) => (
          <div
            key={p.server_name}
            className="flex items-start justify-between py-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs">{p.server_name}</span>
              {p.description && (
                <span className="text-xs text-muted-foreground">
                  {p.description}
                </span>
              )}
              {p.suggested_cmd && (
                <code className="rounded-lg bg-muted px-1 py-0.5 text-xs">
                  {p.suggested_cmd}
                </code>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Pill
                label={p.status}
                tone={
                  p.status === "installed"
                    ? "ok"
                    : p.status === "rejected"
                      ? "bad"
                      : p.status === "vetted"
                        ? "info"
                        : "muted"
                }
              />
              {p.status === "vetted" && (
                <button
                  type="button"
                  disabled={busy === p.server_name}
                  onClick={() => install(p.server_name)}
                  className="rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  {t.evolutionControl.mcp.installDisabled}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
