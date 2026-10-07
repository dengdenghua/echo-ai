import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { AutomationPictureInPicture } from "./automation-picture-in-picture";
import { captureBrowserRelayPreview } from "@/core/browser/api";
import { captureComputerScreen } from "@/core/computer/api";

const captureAutomationPreview = vi.fn();

vi.mock("@/core/browser/api", () => ({
  captureBrowserRelayPreview: vi.fn(),
}));

vi.mock("@/core/computer/api", () => ({
  captureComputerScreen: vi.fn(),
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
          kind: "browser_tab",
          source: "browser_relay",
          id: "42",
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
          kind: "browser_tab",
          id: "42",
          title: "Release dashboard",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("captures the remote browser through the service without using this computer's native capture", async () => {
    window.history.replaceState({}, "", "/?echoRemote=host-a");
    vi.mocked(captureBrowserRelayPreview).mockResolvedValue({
      dataUrl: "data:image/png;base64,cmVtb3Rl",
      matched: true,
    });
    renderWithProviders(
      <AutomationPictureInPicture
        threadId="thread-1"
        target={{
          kind: "browser_tab",
          source: "browser_relay",
          id: "42",
          title: "Remote dashboard",
        }}
        open
        active
        paused={false}
        relayConnected
        stateLabel="Running"
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByAltText("Remote dashboard")).toHaveAttribute(
      "src",
      "data:image/png;base64,cmVtb3Rl",
    );
    expect(captureAutomationPreview).not.toHaveBeenCalled();
    expect(captureComputerScreen).not.toHaveBeenCalled();
  });

  it("discards a late frame after the selected target changes", async () => {
    let resolveOld!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveOld = resolve;
    });
    captureAutomationPreview.mockImplementation(({ id }) =>
      id === "old"
        ? pending
        : Promise.resolve({
            ok: true,
            dataUrl: "data:image/png;base64,bmV3",
            matched: true,
          }),
    );
    const props = {
      threadId: "thread-1",
      open: true,
      active: true,
      paused: false,
      relayConnected: true,
      stateLabel: "Running",
      onOpenChange: () => {},
    };
    const { rerender } = renderWithProviders(
      <AutomationPictureInPicture
        {...props}
        target={{
          kind: "desktop_window",
          source: "computer",
          id: "old",
          title: "Old window",
        }}
      />,
    );
    await waitFor(() => expect(captureAutomationPreview).toHaveBeenCalled());
    rerender(
      <AutomationPictureInPicture
        {...props}
        target={{
          kind: "desktop_window",
          source: "computer",
          id: "new",
          title: "New window",
        }}
      />,
    );
    expect(await screen.findByAltText("New window")).toHaveAttribute(
      "src",
      "data:image/png;base64,bmV3",
    );
    await act(async () => {
      resolveOld({
        ok: true,
        dataUrl: "data:image/png;base64,b2xk",
        matched: true,
      });
      await pending;
    });
    expect(screen.getByAltText("New window")).toHaveAttribute(
      "src",
      "data:image/png;base64,bmV3",
    );
  });
});
