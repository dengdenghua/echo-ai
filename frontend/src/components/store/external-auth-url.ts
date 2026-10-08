/**
 * Server-provided authorization URLs (device-flow verification pages, OAuth
 * authorize endpoints) come from plugin/connector metadata. Only plain
 * http(s) pages may be opened; `javascript:`, `data:`, `file:` and friends are
 * refused so a hostile manifest cannot script the app window.
 */
export function safeExternalAuthUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Open an authorization page in a popup the app keeps a handle to (callers
 * detect blocked popups), but sever `window.opener` so the third-party page
 * cannot navigate or message the app. Returns `null` when the URL is refused
 * or the popup was blocked.
 */
export function openExternalAuthPopup(
  raw: string | null | undefined,
  target: string,
  features?: string,
): Window | null {
  const url = safeExternalAuthUrl(raw);
  if (!url) return null;
  const popup = window.open(url, target, features);
  if (popup) {
    try {
      popup.opener = null;
    } catch {
      // Some embedders expose a read-only proxy; the popup is still usable.
    }
  }
  return popup;
}

/** Open an authorization page in a new tab with no opener and no referrer. */
export function openExternalAuthTab(raw: string | null | undefined): boolean {
  const url = safeExternalAuthUrl(raw);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
