import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrganizationDetail } from "@/components/organizations/organization-detail";
import {
  orgError,
  useOrgAction,
} from "@/components/organizations/use-org-action";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import {
  createOrganization,
  listOrganizations,
} from "@/core/organizations/api";
import { ORG_COPY, type OrgCopy } from "@/core/organizations/copy";
import { organizationActor } from "@/core/organizations/permissions";
import { useI18n } from "@/core/i18n/hooks";
import { useAuth } from "@/providers/AuthProvider";

function OrganizationWorkspace({
  actor,
  copy,
}: {
  actor: string;
  copy: OrgCopy;
}) {
  const query = useQuery({
    queryKey: ["organizations", actor],
    queryFn: ({ signal }) => listOrganizations(signal),
    retry: false,
  });
  const action = useOrgAction(copy, () => query.refetch());
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const organizations = query.data ?? [];
  const organization =
    organizations.find((entry) => entry.id === selected) ?? organizations[0];
  return (
    <WorkspaceContainer mobileNavigation>
      <WorkspaceBody>
        <main className="w-full max-w-6xl space-y-5 px-1 pb-8 sm:px-4">
          <header>
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>
          </header>
          {!!actor ? (
            <form
              className="workspace-panel flex flex-wrap items-end gap-3 rounded-lg px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || action.busy) return;
                void action.run(async () => {
                  const created = await createOrganization(name.trim(), actor);
                  setSelected(created.id);
                  setName("");
                });
              }}
            >
              <label className="min-w-0 max-w-sm flex-1 space-y-1.5 text-sm">
                <span className="block font-medium">{copy.name}</span>
                <Input
                  required
                  maxLength={256}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Button disabled={!name.trim() || action.busy}>
                {copy.create}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">{copy.signedIn}</p>
          )}
          {action.error && (
            <p role="alert" className="text-destructive">
              {action.error}
            </p>
          )}
          {query.isPending && <p role="status">{copy.loading}</p>}
          {query.error && (
            <div role="alert">
              <p>{orgError(query.error, copy)}</p>
              <Button variant="outline" onClick={() => void query.refetch()}>
                {copy.retry}
              </Button>
            </div>
          )}
          {query.data && !query.error && !organizations.length && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/15 px-6 text-center">
              <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Building2Icon className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">{copy.empty}</p>
                {!!actor && (
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                    {copy.emptyHint}
                  </p>
                )}
              </div>
            </div>
          )}
          {query.data && !query.error && !!organizations.length && (
            <div className="flex min-w-0 flex-col gap-6 md:flex-row">
              <nav
                aria-label={copy.title}
                className="w-full shrink-0 space-y-2 md:w-52"
              >
                {organizations.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-current={
                      entry.id === organization?.id ? "page" : undefined
                    }
                    className="block w-full break-words rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted aria-[current=page]:bg-muted"
                    onClick={() => setSelected(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
                <Button
                  variant="outline"
                  disabled={query.isFetching || action.busy}
                  onClick={() => void query.refetch()}
                >
                  {copy.refresh}
                </Button>
              </nav>
              {organization && (
                <OrganizationDetail
                  key={`${actor}:${organization.id}`}
                  organization={organization}
                  actor={actor}
                  copy={copy}
                  reloadOrganizations={() => query.refetch()}
                />
              )}
            </div>
          )}
        </main>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
export default function OrganizationsPage() {
  const { user, isAuthenticated, authStatus, isLoading } = useAuth();
  const { locale } = useI18n();
  const copy = ORG_COPY[locale];
  const actor = organizationActor(
    user,
    isAuthenticated && authStatus?.enabled === true,
  );
  if (isLoading) return <p role="status">{copy.loading}</p>;
  // Remount every account scope: discard drafts, confirmations and late mutation results.
  return (
    <OrganizationWorkspace
      key={`${user?.actor_id || user?.user_id || "local"}:${actor}`}
      actor={actor}
      copy={copy}
    />
  );
}
