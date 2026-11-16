/**
 * Desktop owner auto sign-in.
 *
 * Signing in as the local owner used to be a deliberate click ("以本机账户继续").
 * On a single-user desktop install that click is pure ceremony: the auth
 * bootstrap finishes, the machine sits on a login page until someone presses
 * the button, and nothing in the app works until then (2026-10-22: 12 s between
 * the last bootstrap request and the login POST). It is now automatic by
 * default, with two escape hatches:
 *
 * - ``setDesktopAutoLoginEnabled(false)`` — the account-settings switch, a
 *   per-machine preference that survives restarts.
 * - ``suppressDesktopAutoLogin()`` — called on an explicit sign-out for the
 *   rest of the session, so "退出登录" cannot bounce straight back into a
 *   signed-in shell.
 */

const ENABLED_KEY = "echo_desktop_auto_login";
const SIGNED_OUT_KEY = "echo_desktop_signed_out";

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(store: "local" | "session", key: string, value: string | null): void {
  try {
    const target = store === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // Private-mode storage failures must not break sign-in.
  }
}

export function isDesktopAutoLoginEnabled(): boolean {
  return readLocal(ENABLED_KEY) !== "0";
}

export function setDesktopAutoLoginEnabled(enabled: boolean): void {
  write("local", ENABLED_KEY, enabled ? "1" : "0");
  if (enabled) clearDesktopAutoLoginSuppression();
}

export function suppressDesktopAutoLogin(): void {
  write("session", SIGNED_OUT_KEY, "1");
}

export function clearDesktopAutoLoginSuppression(): void {
  write("session", SIGNED_OUT_KEY, null);
}

function isSuppressed(): boolean {
  try {
    return window.sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The desktop bridge is what makes a one-click owner sign-in possible at all. */
export function desktopAutoLoginAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.echo?.auth?.desktopOwnerLogin === "function"
  );
}

export function shouldAutoLoginDesktopOwner(): boolean {
  return (
    desktopAutoLoginAvailable() &&
    isDesktopAutoLoginEnabled() &&
    !isSuppressed()
  );
}