import { useOptionalAuth } from "@/providers/AuthProvider";

import { canAccessGlobalControlPlane } from "./control-plane-access";

/**
 * Whether this session may ask for process-global (``cross_tenant=true``)
 * views. Panels check it before requesting, so an account without the
 * durable cross-tenant scope sees a stable explanation instead of a 403 per
 * poll. The server still makes the decision on every request.
 */
export function useGlobalControlPlaneAccess(): boolean {
  const auth = useOptionalAuth();
  return canAccessGlobalControlPlane(
    auth?.authStatus ?? null,
    auth?.user ?? null,
  );
}
