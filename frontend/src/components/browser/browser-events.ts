/** Window events that open page tools owned by the browser page. */
export const BROWSER_FIND_EVENT = "echo:browser-find";
export const BROWSER_READER_EVENT = "echo:browser-reader";

export function openBrowserFind(): void {
  window.dispatchEvent(new Event(BROWSER_FIND_EVENT));
}

export function openBrowserReader(): void {
  window.dispatchEvent(new Event(BROWSER_READER_EVENT));
}
