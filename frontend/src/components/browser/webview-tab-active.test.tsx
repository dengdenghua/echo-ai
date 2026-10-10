import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { BROWSER_HOME_URL, type BrowserTab } from "./browser-store";
import { WebviewTab } from "./webview-tab";

describe("active browser tab reporting", () => {
  afterEach(() => {
    delete (window as { echo?: unknown }).echo;
  });

  it("reports the page once a tab leaves the start page", () => {
    const setActiveTab = vi.fn();
    (window as { echo?: unknown }).echo = {
      isElectron: true,
      bridge: { setActiveTab },
      browser: { setDevice: vi.fn().mockResolvedValue(undefined) },
      on: () => () => {},
    };
    const tab: BrowserTab = {
      id: "t1",
      url: BROWSER_HOME_URL,
      title: "",
      isLoading: false,
      device: "desktop",
    };
    const view = renderWithProviders(
      <WebviewTab tab={tab} active onPatch={vi.fn()} />,
      { locale: "zh-CN" },
    );
    expect(document.querySelector("webview")).toBeNull();

    view.rerender(
      <WebviewTab
        tab={{ ...tab, url: "https://example.com/" }}
        active
        onPatch={vi.fn()}
      />,
    );
    const webview = document.querySelector("webview") as HTMLElement & {
      getWebContentsId?: () => number;
    };
    expect(webview).not.toBeNull();
    webview.getWebContentsId = () => 42;
    act(() => {
      webview.dispatchEvent(new Event("dom-ready"));
    });
    expect(setActiveTab).toHaveBeenLastCalledWith(42);
  });
});
