import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import type { WebviewTabHandle } from "./webview-tab";

/**
 * Tab requests from the desktop shell: pages and extensions open tabs,
 * extensions switch to or close one by webContents id
 * (chrome.tabs.update / remove), and an extension's toolbar menu opens the
 * extensions manager.
 */
export function useShellTabEvents(
  handlesRef: RefObject<Map<string, WebviewTabHandle | null>>,
  actions: {
    openTab: (url: string) => void;
    activateTab: (tabId: string) => void;
    closeTab: (tabId: string) => void;
    openManager: () => void;
  },
) {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });

  useEffect(() => {
    const on = window.echo?.on;
    if (!on) return;
    const tabFor = (webContentsId: unknown) => {
      for (const [tabId, handle] of handlesRef.current ?? []) {
        if (handle?.getWebContentsId() === Number(webContentsId)) return tabId;
      }
      return null;
    };
    const offs = [
      on("browser:open-tab", (payload) => {
        const url =
          typeof payload === "string"
            ? payload
            : (payload as { url?: string } | undefined)?.url;
        if (url) latest.current.openTab(url);
      }),
      on("browser:focus-webcontents", (id) => {
        const tabId = tabFor(id);
        if (tabId) latest.current.activateTab(tabId);
      }),
      on("browser:close-webcontents", (id) => {
        const tabId = tabFor(id);
        if (tabId) latest.current.closeTab(tabId);
      }),
      on("browser:open-extensions", () => latest.current.openManager()),
    ];
    return () => offs.forEach((off) => off());
  }, [handlesRef]);
}
