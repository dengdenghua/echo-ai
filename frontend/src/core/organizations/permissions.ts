import type { ChannelMember, OrgRole } from "./api";
import type { User } from "@/core/auth/types";

export function organizationActor(
  user: User | null,
  authenticated: boolean,
): string {
  if (!authenticated || !user || user.is_guest || user.is_account_free)
    return "";
  const id = (user.actor_id || user.user_id).trim();
  return [
    "anonymous",
    "__anonymous__",
    "__guest__",
    "__account_free__",
  ].includes(id.toLowerCase())
    ? ""
    : id;
}
export function membershipPermissions(
  members: ChannelMember[],
  actor: string,
  eligible = true,
) {
  const role =
    eligible && actor
      ? members.find((entry) => entry.member_id === actor)?.role
      : undefined;
  const owner = role === "owner";
  const manage = owner || role === "admin";
  const ownerCount = members.filter((entry) => entry.role === "owner").length;
  const canEdit = (entry: ChannelMember) =>
    manage && (entry.role !== "owner" || owner);
  const lastOwner = (entry: ChannelMember) =>
    entry.role === "owner" && ownerCount <= 1;
  const canSave = (entry: ChannelMember, next: OrgRole) =>
    canEdit(entry) &&
    (next !== "owner" || owner) &&
    (!lastOwner(entry) || next === "owner");
  return { role, owner, manage, canEdit, lastOwner, canSave };
}
