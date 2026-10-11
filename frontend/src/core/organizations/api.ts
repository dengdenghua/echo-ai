import { apiDelete, apiGet, apiPost } from "@/core/api/request";
import { isRecord } from "@/core/utils/guards";

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type OrgMember = {
  member_id: string;
  kind: "human" | "agent";
  role: OrgRole;
  display_name: string;
};
export type Organization = { id: string; name: string; owner_id: string };
export type OrgDepartment = {
  id: string;
  name: string;
  parent_id: string | null;
};
export type OrgChannel = {
  id: string;
  name: string;
  kind: "channel" | "group";
  department_id: string | null;
};
export type OrgDetails = {
  members: OrgMember[];
  departments: OrgDepartment[];
  channels: OrgChannel[];
};

export function isOrgRole(value: unknown): value is OrgRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
  );
}
function invalid(): never {
  throw new Error("Invalid organization response");
}
function organization(value: unknown): Organization {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.owner_id !== "string"
  )
    return invalid();
  return { id: value.id, name: value.name, owner_id: value.owner_id };
}
function member(value: unknown): OrgMember {
  if (
    !isRecord(value) ||
    typeof value.member_id !== "string" ||
    (value.kind !== "human" && value.kind !== "agent") ||
    !isOrgRole(value.role) ||
    typeof value.display_name !== "string"
  )
    return invalid();
  return {
    member_id: value.member_id,
    kind: value.kind,
    role: value.role,
    display_name: value.display_name,
  };
}
function department(value: unknown): OrgDepartment {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.parent_id !== null && typeof value.parent_id !== "string")
  )
    return invalid();
  return { id: value.id, name: value.name, parent_id: value.parent_id };
}
function channel(value: unknown): OrgChannel {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    (value.kind !== "channel" && value.kind !== "group") ||
    (value.department_id !== null && typeof value.department_id !== "string")
  )
    return invalid();
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    department_id: value.department_id,
  };
}
function rows<T>(value: unknown, key: string, parse: (row: unknown) => T): T[] {
  if (!isRecord(value)) return invalid();
  const entries = value[key];
  if (!Array.isArray(entries)) return invalid();
  return entries.map(parse);
}

export async function listOrganizations(
  signal?: AbortSignal,
): Promise<Organization[]> {
  return rows(
    await apiGet("/api/orgs", { signal }),
    "organizations",
    organization,
  );
}
export async function getOrgDetails(
  org_id: string,
  signal?: AbortSignal,
): Promise<OrgDetails> {
  const [members, departments, channels] = await Promise.all([
    apiGet("/api/orgs/{org_id}/members", { path: { org_id }, signal }),
    apiGet("/api/orgs/{org_id}/departments", { path: { org_id }, signal }),
    apiGet("/api/orgs/{org_id}/channels", { path: { org_id }, signal }),
  ]);
  return {
    members: rows(members, "members", member),
    departments: rows(departments, "departments", department),
    channels: rows(channels, "channels", channel),
  };
}
export async function createOrganization(
  name: string,
  owner_id: string,
): Promise<Organization> {
  return organization(await apiPost("/api/orgs", { body: { name, owner_id } }));
}
export function saveOrgMember(org_id: string, entry: OrgMember) {
  return apiPost("/api/orgs/{org_id}/members", {
    path: { org_id },
    body: entry,
  });
}
export function removeOrgMember(org_id: string, member_id: string) {
  return apiDelete("/api/orgs/{org_id}/members/{member_id}", {
    path: { org_id, member_id },
  });
}
export function deleteOrganization(org_id: string) {
  return apiDelete("/api/orgs/{org_id}", { path: { org_id } });
}
export function createOrgDepartment(
  org_id: string,
  name: string,
  parent_id: string | null,
) {
  return apiPost("/api/orgs/{org_id}/departments", {
    path: { org_id },
    body: { name, parent_id },
  });
}
export function deleteOrgDepartment(org_id: string, dept_id: string) {
  return apiDelete("/api/orgs/{org_id}/departments/{dept_id}", {
    path: { org_id, dept_id },
  });
}
export function createOrgChannel(
  org_id: string,
  name: string,
  department_id: string | null,
) {
  return apiPost("/api/orgs/{org_id}/channels", {
    path: { org_id },
    body: { name, department_id, kind: "channel" },
  });
}
export type ChannelMember = { member_id: string; role: OrgRole };
export async function listChannelMembers(
  channel_id: string,
  signal?: AbortSignal,
): Promise<ChannelMember[]> {
  return rows(
    await apiGet("/api/channels/{channel_id}/members", {
      path: { channel_id },
      signal,
    }),
    "members",
    (value) => {
      if (
        !isRecord(value) ||
        typeof value.member_id !== "string" ||
        !isOrgRole(value.role)
      )
        return invalid();
      return { member_id: value.member_id, role: value.role };
    },
  );
}
export function saveChannelMember(channel_id: string, entry: ChannelMember) {
  return apiPost("/api/channels/{channel_id}/members", {
    path: { channel_id },
    body: entry,
  });
}
export function removeChannelMember(channel_id: string, member_id: string) {
  return apiDelete("/api/channels/{channel_id}/members/{member_id}", {
    path: { channel_id, member_id },
  });
}
export function deleteOrgChannel(channel_id: string) {
  return apiDelete("/api/channels/{channel_id}", { path: { channel_id } });
}
