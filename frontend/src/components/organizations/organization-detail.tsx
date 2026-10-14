import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  deleteOrganization,
  getOrgDetails,
  removeOrgMember,
  saveOrgMember,
  type Organization,
} from "@/core/organizations/api";
import type { OrgCopy } from "@/core/organizations/copy";
import { membershipPermissions } from "@/core/organizations/permissions";
import { ChannelPanel } from "./channel-panel";
import { DepartmentPanel } from "./department-panel";
import { MembershipList, OrgMemberForm } from "./member-controls";
import { orgError, useOrgAction } from "./use-org-action";

export function OrganizationDetail({
  organization,
  actor,
  copy,
  reloadOrganizations,
}: {
  organization: Organization;
  actor: string;
  copy: OrgCopy;
  reloadOrganizations: () => Promise<unknown>;
}) {
  const query = useQuery({
    queryKey: ["organization-details", actor, organization.id],
    queryFn: ({ signal }) => getOrgDetails(organization.id, signal),
    retry: false,
  });
  const reload = async () => {
    await query.refetch();
    await reloadOrganizations();
  };
  const action = useOrgAction(copy, reload);
  if (query.isPending) return <p role="status">{copy.loading}</p>;
  if (query.error || !query.data)
    return (
      <div role="alert" className="space-y-2">
        <p>{orgError(query.error, copy)}</p>
        <Button onClick={() => void reload()}>{copy.retry}</Button>
      </div>
    );
  const { members, departments, channels } = query.data;
  const permissions = membershipPermissions(members, actor);
  return (
    <article
      className="min-w-0 flex-1 space-y-7"
      aria-label={organization.name}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 break-words text-xl font-semibold">
          {organization.name}
        </h2>
        <Button
          variant="outline"
          disabled={action.busy || query.isFetching}
          onClick={() => void reload()}
        >
          {copy.refresh}
        </Button>
        {permissions.owner && (
          <Button
            variant="destructive"
            disabled={action.busy}
            onClick={() =>
              action.request({
                title: copy.confirmOrg,
                description: `${organization.name}. ${copy.orgCascade}`,
                run: () => deleteOrganization(organization.id),
              })
            }
          >
            {copy.delete}
          </Button>
        )}
      </header>
      {!permissions.manage && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {copy.readOnly}
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-destructive">
          {action.error}
        </p>
      )}
      <section aria-label={copy.members} className="space-y-3">
        <h2 className="text-lg font-semibold">{copy.members}</h2>
        <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {members.map((entry) => (
            <li key={entry.member_id} className="break-all">
              {entry.display_name || entry.member_id} ·{" "}
              {entry.kind === "human" ? copy.human : copy.agent}
            </li>
          ))}
        </ul>
        <MembershipList
          entries={members}
          actor={actor}
          eligible={!!actor}
          copy={copy}
          action={action}
          save={(entry) => {
            const member = members.find(
              (item) => item.member_id === entry.member_id,
            );
            return member
              ? saveOrgMember(organization.id, { ...member, role: entry.role })
              : Promise.reject(new Error(copy.conflict));
          }}
          remove={(id) => removeOrgMember(organization.id, id)}
        />
        {permissions.manage && (
          <OrgMemberForm
            orgMembers={members}
            actor={actor}
            copy={copy}
            action={action}
            save={(entry) => saveOrgMember(organization.id, entry)}
          />
        )}
      </section>
      <DepartmentPanel
        orgId={organization.id}
        departments={departments}
        manage={permissions.manage}
        copy={copy}
        action={action}
      />
      <ChannelPanel
        orgId={organization.id}
        channels={channels}
        departments={departments}
        orgMembers={members}
        actor={actor}
        manage={permissions.manage}
        copy={copy}
        action={action}
        reload={reload}
      />
      {action.dialog}
    </article>
  );
}
