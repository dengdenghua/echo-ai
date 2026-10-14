import { getBackendBaseURL } from "@/core/config";

/**
 * Sandbox for the live browser-preview iframe. The URL is agent-controlled,
 * so the frame always gets an opaque origin: no `allow-same-origin`, which
 * keeps it away from the app's token storage, cookies and same-origin APIs.
 */
export const LIVE_PREVIEW_SANDBOX = "allow-scripts allow-forms allow-popups";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

function comparableOrigin(url: URL): string {
  const host = LOOPBACK_HOSTS.has(url.hostname) ? "loopback" : url.hostname;
  const port =
    url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return `${url.protocol}//${host}:${port}`;
}

/** Origins of the app itself and of its backend (API + served files). */
export function appPreviewOrigins(): string[] {
  if (typeof window === "undefined") return [];
  const origins = [window.location.origin];
  try {
    origins.push(new URL(getBackendBaseURL() || "/", window.location.href).origin);
  } catch {
    // Unparseable backend base: the app origin alone is still refused.
  }
  return origins;
}

/**
 * Normalize an agent/user supplied URL for the live preview iframe, or return
 * `""` when it must not be embedded: non-http(s) schemes, and anything served
 * from the app's own (or its backend's) origin — loopback aliases included —
 * which would otherwise render attacker-controlled HTML next to the session.
 */
export function normalizePreviewUrl(
  url: string,
  protectedOrigins: readonly string[] = appPreviewOrigins(),
): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  let candidate = "";
  if (/^https?:\/\//i.test(trimmed)) {
    candidate = trimmed;
  } else if (
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?(\/|$)/i.test(
      trimmed,
    )
  ) {
    candidate = `http://${trimmed}`;
  }
  if (!candidate) return "";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }
  const target = comparableOrigin(parsed);
  for (const origin of protectedOrigins) {
    try {
      if (comparableOrigin(new URL(origin)) === target) return "";
    } catch {
      // Ignore malformed entries; they cannot match a valid URL.
    }
  }
  return candidate;
}
