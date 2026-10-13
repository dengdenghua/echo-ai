import type { AuthStatus, User } from "./types";

const GLOBAL_SCOPES = new Set([
  "evolution:cross_tenant",
  "tenant:cross_tenant",
  "global:admin",
  "*",
]);

/** Operator-only control surfaces remain available in local auth-off mode. */
export function canAccessOperatorControlPlane(
  authStatus: AuthStatus | null,
  user: User | null,
): boolean {
  if (authStatus?.enabled === false) return true;
  if (!authStatus?.enabled || !user) return false;
  const roles = new Set(user.roles ?? []);
  return roles.has("admin") || roles.has("operator");
}

/** Cross-tenant process-global controls require an admin and a durable scope. */
export function canAccessGlobalControlPlane(
  authStatus: AuthStatus | null,
  user: User | null,
): boolean {
  if (authStatus?.enabled === false) return true;
  if (!authStatus?.enabled || !user?.roles?.includes("admin")) return false;
  // ``/api/auth/me`` reports the durable scopes the server authorizes on.
  // Without one the server refuses every cross-tenant request, so asking
  // anyway only produces a 403 per poll.
  const permissions = user.permissions ?? [];
  return permissions.some((permission) => GLOBAL_SCOPES.has(permission));
}
