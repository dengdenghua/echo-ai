import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ElectronTitleBar,
  ElectronTitleBarProvider,
  isMac,
  isWindows,
  useElectronTitleBar,
} from "./electron-title-bar";
import { WorkspaceNavigationControls } from "./workspace/mac-window-controls";

afterEach(() => vi.unstubAllGlobals());

function LayoutProbe() {
  const { titleBarInset, contentTopInset } = useElectronTitleBar();
  return (
    <output data-testid="inset" data-content-inset={contentTopInset}>
      {titleBarInset}
    </output>
  );
}

it("uses the desktop bridge instead of browser platform sniffing", () => {
  vi.stubGlobal("echo", { isElectron: true, platform: "darwin" });
  expect(isMac()).toBe(true);
  expect(isWindows()).toBe(false);
  render(<WorkspaceNavigationControls />);
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["darwin", "win32"])(
  "removes and restores the %s reserved row on native fullscreen events",
  async (platform) => {
    let onFullscreen: ((payload: { fullScreen: boolean }) => void) | undefined;
    const unsubscribe = vi.fn();
    vi.stubGlobal("echo", {
      isElectron: true,
      platform,
      window: {
        isFullScreen: vi
          .fn()
          .mockResolvedValue({ ok: true, fullScreen: false }),
        setTitleBarOverlay: vi.fn().mockResolvedValue({ ok: true }),
      },
      on: vi.fn((_event, listener) => {
        onFullscreen = listener;
        return unsubscribe;
      }),
    });
    const { unmount, container } = render(
      <ElectronTitleBarProvider>
        <ElectronTitleBar />
        <LayoutProbe />
      </ElectronTitleBarProvider>,
    );
    await waitFor(() => expect(onFullscreen).toBeDefined());
    const expectedInset =
      platform === "win32" ? "env(titlebar-area-height, 36px)" : "36px";
    expect(screen.getByTestId("inset")).toHaveTextContent(expectedInset);
    expect(screen.getByTestId("inset")).toHaveAttribute(
      "data-content-inset",
      expectedInset,
    );
    expect(
      container.querySelector(
        `[data-window-titlebar="${platform === "win32" ? "right" : "left"}"]`,
      ),
    ).toBeInTheDocument();
    act(() => onFullscreen!({ fullScreen: true }));
    expect(screen.getByTestId("inset")).toHaveTextContent("0px");
    expect(screen.getByTestId("inset")).toHaveAttribute(
      "data-content-inset",
      "0px",
    );
    expect(container.querySelector("[data-window-titlebar]")).toBeNull();
    act(() => onFullscreen!({ fullScreen: false }));
    expect(screen.getByTestId("inset")).toHaveTextContent(expectedInset);
    expect(screen.getByTestId("inset")).toHaveAttribute(
      "data-content-inset",
      expectedInset,
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  },
);

it("does not add a fake title bar to Linux or ordinary web pages", () => {
  vi.stubGlobal("echo", { isElectron: true, platform: "linux" });
  const { container, rerender } = render(<ElectronTitleBar />);
  expect(container).toBeEmptyDOMElement();
  vi.stubGlobal("echo", undefined);
  rerender(<ElectronTitleBar />);
  expect(container).toBeEmptyDOMElement();
});

it("honors a desktop window that already has a native system frame", () => {
  vi.stubGlobal("echo", {
    isElectron: true,
    platform: "win32",
    windowControlsOverlay: false,
  });
  const { container } = render(<ElectronTitleBar />);
  expect(container).toBeEmptyDOMElement();
});

it("removes the extra title row only while the workspace shares native controls", async () => {
  vi.stubGlobal("echo", {
    isElectron: true,
    platform: "win32",
    window: {
      isFullScreen: vi.fn().mockResolvedValue({ ok: true, fullScreen: false }),
      setTitleBarOverlay: vi.fn().mockResolvedValue({ ok: true }),
    },
    on: vi.fn(() => vi.fn()),
  });
  const { container, rerender } = render(
    <ElectronTitleBarProvider sharedToolbar>
      <ElectronTitleBar />
      <LayoutProbe />
    </ElectronTitleBarProvider>,
  );
  expect(container.querySelector("[data-window-titlebar]")).toBeNull();
  expect(screen.getByTestId("inset")).toHaveAttribute(
    "data-content-inset",
    "0px",
  );
  rerender(
    <ElectronTitleBarProvider>
      <ElectronTitleBar />
      <LayoutProbe />
    </ElectronTitleBarProvider>,
  );
  await waitFor(() =>
    expect(
      container.querySelector("[data-window-titlebar=right]"),
    ).toBeInTheDocument(),
  );
  expect(screen.getByTestId("inset")).toHaveAttribute(
    "data-content-inset",
    "env(titlebar-area-height, 36px)",
  );
});
