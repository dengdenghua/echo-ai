/**
 * Hands a question from the browser start page to the assistant panel.
 *
 * The panel mounts only once it is opened, so the question waits here until
 * the panel takes it (on mount, or on the event if it is already open).
 */
export const BROWSER_ASSISTANT_ASK_EVENT = "echo:browser-assistant-ask";

let pending: string | null = null;

export function requestBrowserAssistantAsk(text: string): void {
  pending = text;
  window.dispatchEvent(new Event(BROWSER_ASSISTANT_ASK_EVENT));
}

export function takeBrowserAssistantAsk(): string | null {
  const text = pending;
  pending = null;
  return text;
}
