import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { type BrowserTab } from "./browser-store";
import { WebviewTab } from "./webview-tab";

describe("browser relay status requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares a pending status read between navigation and polling", async () => {
    let resolveStatus!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveStatus = resolve;
    });
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        return url.endsWith("/api/browser/relay/status")
          ? pending
          : Promise.resolve(
              new Response(JSON.stringify({}), {
                headers: { "Content-Type": "application/json" },
              }),
            );
      }),
    );
    const tab: BrowserTab = {
      id: "relay-sharing",
      url: "https://example.com/",
      title: "",
      isLoading: false,
      device: "desktop",
    };
    const view = renderWithProviders(
      <WebviewTab tab={tab} active onPatch={vi.fn()} />,
    );
    await waitFor(() => {
      expect(
        requests.filter((url) => url.endsWith("/relay/status")),
      ).toHaveLength(1);
    });
    // Both mount effects have started before the pending response resolves.
    await act(async () => {
      resolveStatus(
        new Response(JSON.stringify({ connected: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    await waitFor(() => {
      expect(requests.some((url) => url.endsWith("/relay/command"))).toBe(true);
    });
    view.unmount();
  });
});
