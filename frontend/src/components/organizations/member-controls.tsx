import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isOrgRole,
  type ChannelMember,
  type OrgMember,
  type OrgRole,
} from "@/core/organizations/api";
import type { OrgCopy } from "@/core/organizations/copy";
import { membershipPermissions } from "@/core/organizations/permissions";
import type { OrgAction } from "./use-org-action";

const roles: OrgRole[] = ["owner", "admin", "member", "viewer"];
export const selectClass =
  "h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50";
export function RoleOptions({
  copy,
  owner,
  lastOwner = false,
}: {
  copy: OrgCopy;
  owner: boolean;
  lastOwner?: boolean;
}) {
  return roles.map((role) => (
    <option
      key={role}
      value={role}
      disabled={(role === "owner" && !owner) || (lastOwner && role !== "owner")}
    >
      {copy[role]}
    </option>
  ));
}
export function MembershipList({
  entries,
  actor,
  eligible,
  copy,
  action,
  save,
  remove,
}: {
  entries: ChannelMember[];
  actor: string;
  eligible: boolean;
  copy: OrgCopy;
  action: OrgAction;
  save: (entry: ChannelMember) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}) {
  const permissions = membershipPermissions(entries, actor, eligible);
  return (
    <ul className="divide-y rounded-lg border">
      {entries.map((entry) => (
        <li
          key={entry.member_id}
          className="flex flex-wrap items-center gap-3 p-3"
        >
          <span className="min-w-0 flex-1 break-all text-sm">
            {entry.member_id}
          </span>
          <select
            aria-label={`${copy.role}: ${entry.member_id}`}
            className={selectClass}
            value={entry.role}
            disabled={action.busy || !permissions.canEdit(entry)}
            onChange={(event) => {
              const next = event.target.value;
              if (
                !isOrgRole(next) ||
                next === entry.role ||
                !permissions.canSave(entry, next)
              )
                return;
              action.request({
                title: copy.confirmRole,
                description: `${entry.member_id}: ${copy[entry.role]} → ${copy[next]}`,
                destructive: false,
                run: () => save({ ...entry, role: next }),
              });
            }}
          >
            <RoleOptions
              copy={copy}
              owner={permissions.owner}
              lastOwner={permissions.lastOwner(entry)}
            />
          </select>
          {permissions.canEdit(entry) && (
            <Button
              variant="outline"
              disabled={action.busy || permissions.lastOwner(entry)}
              aria-label={`${copy.remove}: ${entry.member_id}`}
              onClick={() =>
                action.request({
                  title: copy.confirmMember,
                  confirmLabel: copy.remove,
                  description: entry.member_id,
                  run: () => remove(entry.member_id),
                })
              }
            >
              {copy.remove}
            </Button>
          )}
          {permissions.lastOwner(entry) && (
            <span className="w-full text-xs text-muted-foreground">
              {copy.lastOwner}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
export function OrgMemberForm({
  orgMembers,
  actor,
  copy,
  action,
  save,
}: {
  orgMembers: OrgMember[];
  actor: string;
  copy: OrgCopy;
  action: OrgAction;
  save: (entry: OrgMember) => Promise<unknown>;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"human" | "agent">("human");
  const [role, setRole] = useState<OrgRole>("member");
  const permissions = membershipPermissions(orgMembers, actor);
  const existing = orgMembers.find((member) => member.member_id === id.trim());
  const allowed =
    permissions.manage &&
    (role !== "owner" || permissions.owner) &&
    (!existing || permissions.canSave(existing, role));
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!id.trim() || !allowed || action.busy) return;
        const entry: OrgMember = {
          member_id: id.trim(),
          display_name: name.trim(),
          kind,
          role,
        };
        if (existing)
          action.request({
            title: copy.confirmRole,
            description: `${entry.member_id}: ${copy[existing.role]} → ${copy[role]}`,
            destructive: false,
            run: () => save(entry),
          });
        else
          void action.run(async () => {
            await save(entry);
            setId("");
            setName("");
          });
      }}
    >
      <label className="min-w-0 flex-1 basis-40 text-sm">
        {copy.memberId}
        <Input required value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      <label className="min-w-0 flex-1 basis-40 text-sm">
        {copy.displayName}
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        {copy.kind}
        <select
          className={selectClass}
          value={kind}
          onChange={(e) => {
            if (e.target.value === "human" || e.target.value === "agent")
              setKind(e.target.value);
          }}
        >
          <option value="human">{copy.human}</option>
          <option value="agent">{copy.agent}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {copy.role}
        <select
          className={selectClass}
          value={role}
          onChange={(e) => {
            if (isOrgRole(e.target.value)) setRole(e.target.value);
          }}
        >
          <RoleOptions copy={copy} owner={permissions.owner} />
        </select>
      </label>
      <Button disabled={!allowed || !id.trim() || action.busy}>
        {copy.addMember}
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        {copy.identityHint}
      </p>
    </form>
  );
}
