import { FlaskConicalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";

import type { DispatchSnapshot, EvolutionApi } from "./types";
import { Card, EmptyState } from "./ui";

// ---------------------------------------------------------------------------
// Section: A/B dispatch snapshot
// ---------------------------------------------------------------------------

export function DispatchSection({ api }: { api: EvolutionApi }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<DispatchSnapshot>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<DispatchSnapshot>(
        "/api/evolution/dispatch/snapshot",
      );
      setSnap(data || {});
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

  const rows = useMemo(() => Object.entries(snap), [snap]);

  return (
    <Card
      title={t.evolutionControl.dispatch.cardTitle}
      icon={<FlaskConicalIcon className="size-4 text-primary" />}
      onRefresh={load}
      loading={loading}
      error={error}
    >
      {rows.length === 0 && !loading && (
        <EmptyState text={t.evolutionControl.dispatch.empty} />
      )}
      <div className="divide-y divide-border/60">
        {rows.map(([test_id, b]) => (
          <div key={test_id} className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-xs">{b.skill_name}</div>
                <div className="text-xs text-muted-foreground">
                  {t.evolutionControl.dispatch.testPrefix(test_id.slice(0, 8))}
                </div>
              </div>
              <div className="flex gap-4 text-xs tabular-nums text-muted-foreground">
                <span>
                  A: {b.a_assigned} ({b.a_reported})
                </span>
                <span>
                  B: {b.b_assigned} ({b.b_reported})
                </span>
              </div>
            </div>
            {Object.keys(b.outcomes).length > 0 && (
              <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                {Object.entries(b.outcomes).map(([k, v]) => (
                  <span key={k}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
