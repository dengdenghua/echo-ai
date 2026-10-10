/**
 * Key-field guards for the response bodies read in ``./api``. The
 * OpenAPI snapshot declares those routes as plain dicts, so the module
 * narrows them through ``looseBody`` (see ``@/core/api/response``).
 */
import {
  isBoolean,
  isRecord,
  isString,
  isUnknownArray,
} from "@/core/utils/guards";
import type { FileLease, Workspace, WorkspaceMember } from "./types";

export function isFileLease(value: unknown): value is FileLease {
  return (
    isRecord(value) &&
    isString(value.lease_id) &&
    isString(value.workspace_id) &&
    isString(value.holder_id)
  );
}

export function hasReady(value: unknown): value is {
  ready: boolean;
  filesystem_path: string | null;
  detail?: string;
} {
  return isRecord(value) && isBoolean(value.ready);
}

// Older backends wrap lists and single records in an envelope; the API
// functions accept both shapes.

export function isWorkspaceList(
  value: unknown,
): value is Workspace[] | { workspaces: Workspace[] } {
  return (
    isUnknownArray(value) ||
    (isRecord(value) && isUnknownArray(value.workspaces))
  );
}

export function isWorkspaceBody(
  value: unknown,
): value is Workspace | { workspace: Workspace } {
  return isRecord(value) && (isRecord(value.workspace) || isString(value.id));
}

export function isWorkspaceMemberList(
  value: unknown,
): value is WorkspaceMember[] | { members: WorkspaceMember[] } {
  return (
    isUnknownArray(value) || (isRecord(value) && isUnknownArray(value.members))
  );
}

export function isFileLeaseList(
  value: unknown,
): value is FileLease[] | { leases: FileLease[] } {
  return (
    isUnknownArray(value) || (isRecord(value) && isUnknownArray(value.leases))
  );
}
