import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EchoAPIError } from "@/core/api/request";
import { isRecord } from "@/core/utils/guards";
import { useI18n } from "@/core/i18n/hooks";
import { useAuth } from "@/providers/AuthProvider";
import { organizationActor } from "@/core/organizations/permissions";
import {
  STANDING_COPY,
  type StandingCopy,
} from "@/core/projects/standing-copy";
import {
  confirmStandingGrant,
  getStandingGrant,
  reviewStandingGrant,
  revokeStandingGrant,
} from "@/core/projects/standing-api";

type Phase = Record<string, unknown> & { id: string; name: string };

function StandingOwnerPanel({
  projectId,
  phases,
  actor,
  copy,
}: {
  projectId: string;
  phases: Phase[];
  actor: string;
  copy: StandingCopy;
}) {
  const query = useQuery({
    queryKey: ["project-standing-authorization", actor, projectId],
    queryFn: ({ signal }) => getStandingGrant(projectId, signal),
    retry: false,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      lifetime.current = null;
    };
  }, []);
  const eligible = phases.filter((phase) => {
    const budget = isRecord(phase.spec) ? phase.spec.ai_budget_usd : null;
    return (
      !["done", "failed", "blocked"].includes(String(phase.status)) &&
      typeof budget === "number" &&
      Number.isFinite(budget) &&
      budget > 0
    );
  });
  const errorText = (error: unknown) =>
    error instanceof EchoAPIError
      ? error.status === 409
        ? copy.changed
        : [401, 403, 404].includes(error.status)
          ? copy.forbidden
          : copy.failed
      : copy.failed;

  const authorize = async () => {
    const ceiling = Number(limit);
    const chosen = selected.filter((id) =>
      eligible.some((phase) => phase.id === id),
    );
    if (!chosen.length || !Number.isFinite(ceiling) || ceiling <= 0) {
      toast.error(copy.invalid);
      return;
    }
    const controller = lifetime.current;
    if (!controller || busy) return;
    setBusy(true);
    try {
      const reviewed = await reviewStandingGrant(
        projectId,
        chosen,
        ceiling,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const accepted = await confirm({
        title: copy.confirm,
        confirmLabel: copy.confirm,
        cancelLabel: copy.cancel,
        destructive: false,
        description: `${reviewed.phases.map((phase) => `${phase.name} ($${phase.ai_budget_usd})`).join(" · ")}\n${copy.limit}: $${reviewed.limit_usd}\n${copy.bounds}\n${copy.approvals}`,
      });
      if (!accepted || controller.signal.aborted) return;
      await confirmStandingGrant(
        projectId,
        reviewed.review_id,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        toast.success(copy.saved);
        await query.refetch();
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorText(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const revoke = async () => {
    const controller = lifetime.current;
    if (!controller || busy) return;
    setBusy(true);
    try {
      const accepted = await confirm({
        title: copy.revokeTitle,
        description: copy.revokeBody,
        confirmLabel: copy.revoke,
        cancelLabel: copy.cancel,
      });
      if (!accepted || controller.signal.aborted) return;
      await revokeStandingGrant(projectId, controller.signal);
      if (!controller.signal.aborted) {
        toast.success(copy.revoked);
        await query.refetch();
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorText(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <section
      aria-label={copy.title}
      className="space-y-2 rounded-lg border px-3 py-2.5 text-sm"
    >
      <p className="font-medium">{copy.title}</p>
      <p className="text-xs text-muted-foreground">{copy.approvals}</p>
      {query.isLoading ? (
        <p role="status">{copy.loading}</p>
      ) : query.isError ? (
        <div role="alert">
          {errorText(query.error)}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {copy.retry}
          </Button>
        </div>
      ) : (
        <>
          <p role="status">
            {query.data
              ? `${copy.active} · $${query.data.limit_usd}`
              : copy.inactive}
          </p>
          {query.data && (
            <p>
              {query.data.phase_ids
                .map(
                  (id) => phases.find((phase) => phase.id === id)?.name ?? id,
                )
                .join(" · ")}
            </p>
          )}
          <fieldset disabled={busy} className="space-y-1">
            <legend>{copy.phases}</legend>
            {eligible.length === 0 ? (
              <p>{copy.empty}</p>
            ) : (
              eligible.map((phase) => (
                <label key={phase.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(phase.id)}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked
                          ? [...old, phase.id]
                          : old.filter((id) => id !== phase.id),
                      )
                    }
                  />
                  {phase.name}
                </label>
              ))
            )}
            <label className="block">
              {copy.limit}
              <Input
                inputMode="decimal"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
              />
            </label>
          </fieldset>
          <p className="text-xs text-muted-foreground">{copy.bounds}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || eligible.length === 0}
              onClick={() => void authorize()}
            >
              {copy.review}
            </Button>
            {query.data && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void revoke()}
              >
                {copy.revoke}
              </Button>
            )}
          </div>
        </>
      )}
      {confirmDialog}
    </section>
  );
}

function AuthenticatedStandingAuthorizationPanel({
  projectId,
  ownerId,
  phases,
}: {
  projectId: string;
  ownerId: string;
  phases: Phase[];
}) {
  const { user, isAuthenticated, authStatus, isLoading } = useAuth();
  const { locale } = useI18n();
  const actor = organizationActor(
    user,
    isAuthenticated && authStatus?.enabled === true,
  );
  if (isLoading || !actor || actor !== ownerId || user?.is_active === false)
    return null;
  return (
    <StandingOwnerPanel
      key={`${actor}:${projectId}`}
      actor={actor}
      projectId={projectId}
      phases={phases}
      copy={STANDING_COPY[locale]}
    />
  );
}

export function StandingAuthorizationPanel(props: {
  projectId: string;
  ownerId?: string;
  phases: Phase[];
}) {
  return props.ownerId ? (
    <AuthenticatedStandingAuthorizationPanel
      {...props}
      ownerId={props.ownerId}
    />
  ) : null;
}
