import type {
  ConstitutionProfile,
  ConstitutionProfileStatus,
} from "./privacy-types";

export function clearEchoBrowserState(): void {
  if (typeof window === "undefined") return;
  const prefixes = ["echo", "code:", "team:", "realtime:"];
  const exactKeys = new Set([
    "token",
    "echo_auth_token",
    "echo_user",
    "echo_auth_ts",
  ]);
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const key = store.key(i);
      if (!key) continue;
      if (
        exactKeys.has(key) ||
        prefixes.some((prefix) => key.startsWith(prefix))
      ) {
        store.removeItem(key);
      }
    }
  }
  window.dispatchEvent(new Event("storage"));
}

export function isPathList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((path) => typeof path === "string")
  );
}

export function isConstitutionProfileStatus(
  value: ConstitutionProfileStatus,
): boolean {
  const allowed = new Set<ConstitutionProfile>(["strict", "normal", "lax"]);
  return (
    allowed.has(value?.profile) &&
    Array.isArray(value.available) &&
    value.available.length > 0 &&
    value.available.every((profile) => allowed.has(profile)) &&
    value.available.includes(value.profile)
  );
}

export function isAbsoluteLikePath(path: string): boolean {
  if (!path) return false;
  return (
    path.startsWith("/") ||
    path.startsWith("~/") ||
    path.startsWith("$HOME/") ||
    path.startsWith("%USERPROFILE%") ||
    path.startsWith("%APPDATA%") ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}
