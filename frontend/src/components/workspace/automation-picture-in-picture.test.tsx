import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { AutomationPictureInPicture } from "./automation-picture-in-picture";
import { captureComputerWindowPreview } from "@/core/computer/api";
import { captureBrowserRelayPreview } from "@/core/browser/api";

const captureAutomationPreview = vi.fn();

vi.mock("@/core/browser/api", () => ({
  captureBrowserRelayPreview: vi.fn(),
}));

vi.mock("@/core/computer/api", () => ({
  captureComputerWindowPreview: vi.fn(),
}));

describe("<AutomationPictureInPicture />", () => {
  const originalEcho = window.echo;

  beforeEach(() => {
    captureAutomationPreview.mockReset().mockResolvedValue({
      ok: true,
      dataUrl: "data:image/png;base64,cGlw",
      width: 960,
      height: 540,
      sourceId: "window:42:0",
      sourceName: "Release dashboard - Google Chrome",
      matched: true,
    });
    window.localStorage.clear();
    window.echo = {
      isElectron: true,
      desktop: { captureAutomationPreview },
    } as unknown as NonNullable<typeof window.echo>;
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    window.echo = originalEcho;
    vi.clearAllMocks();
  });

  it("renders a native read-only frame and closes without changing the target", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AutomationPictureInPicture
        threadId="thread-1"
        target={{
          kind: "desktop_window",
          source: "computer",
          id: "window:42:0",
          title: "Release dashboard",
          url: "https://example.com/releases",
        }}
        open
        active
        paused={false}
        relayConnected
        stateLabel="Agent controlling"
        onOpenChange={onOpenChange}
      />,
    );

    expect(
      await screen.findByTestId("automation-picture-in-picture"),
    ).toBeInTheDocument();
    expect(await screen.findByAltText("Release dashboard")).toHaveAttribute(
      "src",
      "data:image/png;base64,cGlw",
    );
    await waitFor(() =>
      expect(captureAutomationPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "desktop_window",
          id: "window:42:0",
          title: "Release dashboard",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("captures the selected remote window without using this computer's capture", async () => {
    window.history.replaceState({}, "", "/?echoRemote=host-a");
    const target = {
      kind: "desktop_window" as const,
      source: "computer",
      id: "window:42:0",
      title: "Remote window",
    };
    vi.mocked(captureComputerWindowPreview).mockResolvedValue({
      ok: true,
      data_url: "data:image/png;base64,cmVtb3Rl",
    });
    renderWithProviders(
      <AutomationPictureInPicture
        threadId="remote-thread"
        target={target}
        open
        active
        paused={false}
        relayConnected
        stateLabel="Running"
        onOpenChange={vi.fn()}
      />,
    );
    expect(await screen.findByAltText("Remote window")).toHaveAttribute(
      "src",
      "data:image/png;base64,cmVtb3Rl",
    );
    expect(captureComputerWindowPreview).toHaveBeenCalledWith(target);
    expect(captureAutomationPreview).not.toHaveBeenCalled();
  });

  it("uses the exact browser tab instead of a native browser window", async () => {
    vi.mocked(captureBrowserRelayPreview).mockResolvedValue({
      dataUrl: "data:image/png;base64,dGFi",
    });
    renderWithProviders(
      <AutomationPictureInPicture
        threadId="t"
        target={{
          kind: "browser_tab",
          source: "browser_relay",
          id: "42",
          title: "Exact tab",
        }}
        open
        active
        paused={false}
        relayConnected
        stateLabel="Running"
        onOpenChange={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByAltText("Exact tab")).toHaveAttribute(
        "src",
        "data:image/png;base64,dGFi",
      ),
    );
    expect(captureAutomationPreview).not.toHaveBeenCalled();
  });

  it("discards stale capture when targets change and captures nothing when closed", async () => {
    window.echo = undefined;
    let finishOld!: (value: { ok: boolean; data_url: string }) => void;
    vi.mocked(captureComputerWindowPreview)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, data_url: "data:image/png;base64,bmV3" });
    const props = {
      threadId: "t",
      open: true,
      active: true,
      paused: false,
      relayConnected: false,
      stateLabel: "Running",
      onOpenChange: vi.fn(),
    };
    const first = {
      kind: "desktop_window" as const,
      source: "computer",
      id: "win32:1:1",
      title: "Old",
    };
    const next = { ...first, id: "win32:2:2", title: "New" };
    const view = renderWithProviders(
      <AutomationPictureInPicture {...props} target={first} />,
    );
    view.rerender(<AutomationPictureInPicture {...props} target={next} />);
    await waitFor(() =>
      expect(screen.getByAltText("New")).toHaveAttribute(
        "src",
        "data:image/png;base64,bmV3",
      ),
    );
    finishOld({ ok: true, data_url: "data:image/png;base64,b2xk" });
    await waitFor(() =>
      expect(screen.getByAltText("New")).toHaveAttribute(
        "src",
        "data:image/png;base64,bmV3",
      ),
    );
    const count = vi.mocked(captureComputerWindowPreview).mock.calls.length;
    view.rerender(
      <AutomationPictureInPicture {...props} target={next} open={false} />,
    );
    expect(screen.queryByTestId("automation-picture-in-picture")).toBeNull();
    expect(captureComputerWindowPreview).toHaveBeenCalledTimes(count);
  });
});
