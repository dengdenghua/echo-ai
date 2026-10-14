import { EchoAPIError } from "@/core/api/request";
import { canManageInstanceSettings } from "@/core/auth/control-plane-access";
import type { AuthStatus, User } from "@/core/auth/types";
import { useOptionalAuth } from "@/providers/AuthProvider";

/** The explanation shown where an ordinary account cannot manage a workbench
 * (HUB words it per language: core/i18n/locales/hub.ts). */
export const WORKBENCH_ADMIN_ONLY_HINT =
  "工作台由本机管理员安装和管理，需要时请联系管理员。";

interface WorkbenchAuthView {
  authStatus: AuthStatus | null;
  user: User | null;
}

/**
 * Whether this session may install, update, enable, disable, roll back or
 * remove a workbench package.
 *
 * Packages are machine-wide (installed into this computer's data directory and
 * shared by every account), so the server only accepts these changes from the
 * ``admin`` role, or from anyone when sign-in is off. Outside the auth shell
 * (previews, isolated tests) the role is unknown and the server stays the only
 * judge, so the actions remain offered.
 */
export function canManageWorkbenches(
  auth: WorkbenchAuthView | null | undefined,
): boolean {
  if (!auth) return true;
  return canManageInstanceSettings(auth.authStatus, auth.user);
}

export function useCanManageWorkbenches(): boolean {
  return canManageWorkbenches(useOptionalAuth());
}

/**
 * A refused workbench change reads as the server's own sentence (for example
 * "只有管理员可以安装或移除工作台，请联系本机管理员。") instead of a raw HTTP body,
 * which can still happen when an account's role changed after this page loaded.
 */
export function workbenchActionErrorMessage(error: unknown): string {
  if (
    error instanceof EchoAPIError &&
    error.status === 403 &&
    typeof error.detail === "string" &&
    error.detail.trim()
  ) {
    return error.detail.trim();
  }
  return error instanceof Error ? error.message : String(error);
}
