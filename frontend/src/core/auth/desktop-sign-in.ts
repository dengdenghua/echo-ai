import { isPackagedShell } from "@/core/backend/desktop-shell";
import type { User } from "./types";

// An explicit choice in this window, never an authentication credential.
const CHOICE_KEY = "echo_desktop_owner_sign_in";

export function needsDesktopSignIn(user: Partial<User>) {
  if (!isPackagedShell() || (user.actor_id || user.user_id) !== "local:owner")
    return false;
  try {
    return sessionStorage.getItem(CHOICE_KEY) !== "explicit";
  } catch {
    return true;
  }
}

export function rememberDesktopSignIn(user: User) {
  if (!isPackagedShell() || (user.actor_id || user.user_id) !== "local:owner")
    return;
  try {
    sessionStorage.setItem(CHOICE_KEY, "explicit");
  } catch {
    /* Storage may be unavailable; the current interactive sign-in still works. */
  }
}

export function forgetDesktopSignIn() {
  try {
    sessionStorage.removeItem(CHOICE_KEY);
  } catch {
    /* Nothing to clear when browser storage is unavailable. */
  }
}
