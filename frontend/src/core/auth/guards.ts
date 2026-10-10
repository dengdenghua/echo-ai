/**
 * Key-field guards for the auth bodies read in ``./api`` (raw fetch, see
 * there) and by ``AuthProvider``. They are read through ``looseBody``
 * (see ``@/core/api/response``), so a body that misses a guard is still
 * used as before.
 */
import { isBoolean, isRecord, isString } from "@/core/utils/guards";

import type { AuthStatus, LoginResponse, User } from "./types";

export function isUser(value: unknown): value is User {
  return isRecord(value) && isString(value.user_id) && isString(value.username);
}

export function isAuthStatus(value: unknown): value is AuthStatus {
  return (
    isRecord(value) &&
    isBoolean(value.enabled) &&
    isBoolean(value.allow_registration)
  );
}

export function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    isRecord(value) &&
    isBoolean(value.success) &&
    (value.user === undefined || isUser(value.user))
  );
}

/** An error body: ``detail`` is optional but must be a string when set. */
export function hasDetailMessage(value: unknown): value is { detail?: string } {
  return (
    isRecord(value) && (value.detail === undefined || isString(value.detail))
  );
}
