import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createOrgChannel,
  deleteOrgChannel,
  listChannelMembers,
  removeChannelMember,
  saveChannelMember,
  isOrgRole,
  type OrgChannel,
  type OrgDepartment,
  type OrgMember,
  type OrgRole,
} from "@/core/organizations/api";
import type { OrgCopy } from "@/core/organizations/copy";
import { membershipPermissions } from "@/core/organizations/permissions";
import { DepartmentOptions, departmentPath } from "./department-panel";
import { MembershipList, RoleOptions, selectClass } from "./member-controls";
import { orgError, useOrgAction, type OrgAction } from "./use-org-action";

function ChannelAccess({
  channel,
  actor,
  orgMembers,
  copy,
  reload,
}: {
  channel: OrgChannel;
  actor: string;
  orgMembers: OrgMember[];
  copy: OrgCopy;
  reload: () => Promise<unknown>;
}) {
  const query = useQuery({
    queryKey: ["org-channel-members", actor, channel.id],
    queryFn: ({ signal }) => listChannelMembers(channel.id, signal),
    retry: false,
  });
  const action = useOrgAction(copy, async () => {
    await query.refetch();
    await reload();
  });
  const [id, setId] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const entries = query.data ?? [];
  const eligible =
    !!actor && orgMembers.some((entry) => entry.member_id === actor);
  const permissions = membershipPermissions(entries, actor, eligible);
  const existing = entries.find((entry) => entry.member_id === id);
  const allowed =
    permissions.manage &&
    !!id &&
    orgMembers.some((entry) => entry.member_id === id) &&
    (role !== "owner" || permissions.owner) &&
    (!existing || permissions.canSave(existing, role));
  return (
    <section
      aria-label={`${copy.access}: ${channel.name}`}
      className="space-y-3 rounded-lg border p-4"
    >
      <h3 className="font-semibold">
        {copy.access}: {channel.name}
      </h3>
      <p className="text-xs text-muted-foreground">{copy.accessHint}</p>
      {query.isPending && <p role="status">{copy.loading}</p>}
      {query.error && (
        <p role="alert">
          {orgError(query.error, copy)}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {copy.retry}
          </Button>
        </p>
      )}
      {query.data && !query.error && (
        <MembershipList
          entries={entries}
          actor={actor}
          eligible={eligible}
          copy={copy}
          action={action}
          save={(entry) => saveChannelMember(channel.id, entry)}
          remove={(memberId) => removeChannelMember(channel.id, memberId)}
        />
      )}
      {permissions.manage && !query.error && (
        <>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!allowed || action.busy) return;
              action.request({
                title: copy.confirmRole,
                description: `${channel.name} · ${id}: ${copy[role]}`,
                destructive: false,
                run: () =>
                  saveChannelMember(channel.id, { member_id: id, role }),
              });
            }}
          >
            <label className="grid min-w-0 gap-1 text-sm">
              {copy.memberId}
              <select
                required
                className={selectClass}
                value={id}
                onChange={(event) => setId(event.target.value)}
              >
                <option value="">{copy.memberId}</option>
                {orgMembers.map((entry) => (
                  <option key={entry.member_id} value={entry.member_id}>
                    {entry.display_name || entry.member_id} ({entry.member_id})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {copy.role}
              <select
                className={selectClass}
                value={role}
                onChange={(event) => {
                  if (isOrgRole(event.target.value))
                    setRole(event.target.value);
                }}
              >
                <RoleOptions copy={copy} owner={permissions.owner} />
              </select>
            </label>
            <Button disabled={action.busy || !allowed}>{copy.save}</Button>
          </form>
          <Button
            variant="destructive"
            disabled={action.busy}
            onClick={() =>
              action.request({
                title: copy.confirmChannel,
                description: `${channel.name}. ${copy.channelCascade}`,
                run: () => deleteOrgChannel(channel.id),
              })
            }
          >
            {copy.delete}
          </Button>
        </>
      )}
      {action.error && (
        <p role="alert" className="text-destructive">
          {action.error}
        </p>
      )}
      {action.dialog}
    </section>
  );
}
export function ChannelPanel({
  orgId,
  channels,
  departments,
  orgMembers,
  actor,
  manage,
  copy,
  action,
  reload,
}: {
  orgId: string;
  channels: OrgChannel[];
  departments: OrgDepartment[];
  orgMembers: OrgMember[];
  actor: string;
  manage: boolean;
  copy: OrgCopy;
  action: OrgAction;
  reload: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const departmentId = departments.some((entry) => entry.id === department)
    ? department
    : "";
  const [selected, setSelected] = useState("");
  const channel = channels.find((entry) => entry.id === selected);
  return (
    <section className="space-y-3" aria-label={copy.channels}>
      <h2 className="text-lg font-semibold">{copy.channels}</h2>
      {!channels.length && (
        <p className="text-sm text-muted-foreground">{copy.none}</p>
      )}
      <ul className="space-y-2">
        {channels.map((entry) => {
          const parent = departments.find(
            (item) => item.id === entry.department_id,
          );
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={selected === entry.id}
                className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted aria-pressed:bg-muted"
                onClick={() => setSelected(entry.id)}
              >
                <span className="block break-words font-medium">
                  {entry.name}
                </span>
                <span className="block break-words text-xs text-muted-foreground">
                  {parent ? departmentPath(parent, departments) : copy.root} ·{" "}
                  {entry.id}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {manage && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || action.busy) return;
            void action.run(async () => {
              await createOrgChannel(orgId, name.trim(), departmentId || null);
              setName("");
            });
          }}
        >
          <label className="min-w-0 flex-1 basis-48 text-sm">
            {copy.name}
            <Input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {copy.departments}
            <select
              className={selectClass}
              value={departmentId}
              onChange={(event) => setDepartment(event.target.value)}
            >
              <DepartmentOptions departments={departments} copy={copy} />
            </select>
          </label>
          <Button disabled={action.busy || !name.trim()}>
            {copy.addChannel}
          </Button>
        </form>
      )}
      {channel && (
        <ChannelAccess
          key={`${actor}:${channel.id}`}
          channel={channel}
          actor={actor}
          orgMembers={orgMembers}
          copy={copy}
          reload={reload}
        />
      )}
    </section>
  );
}
