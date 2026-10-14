/**
 * Hands a question from the browser start page to the assistant panel.
 *
 * The panel mounts only once it is opened, so the question waits here until
 * the panel takes it (on mount, or on the event if it is already open).
 */
export const BROWSER_ASSISTANT_ASK_EVENT = "echo:browser-assistant-ask";

/** "send" asks right away; "draft" puts the text in the input to finish. */
export type BrowserAssistantAskMode = "send" | "draft";

let pending: { text: string; mode: BrowserAssistantAskMode } | null = null;

export function requestBrowserAssistantAsk(
  text: string,
  mode: BrowserAssistantAskMode = "send",
): void {
  pending = { text, mode };
  window.dispatchEvent(new Event(BROWSER_ASSISTANT_ASK_EVENT));
}

export function takeBrowserAssistantAsk(): {
  text: string;
  mode: BrowserAssistantAskMode;
} | null {
  const request = pending;
  pending = null;
  return request;
}
