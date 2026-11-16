export const DESKTOP_TITLE_BAR_HEIGHT = 36;

export function resolveWindowChrome(
  platform: string | undefined,
  desktop: boolean,
  fullScreen = false,
  windowControlsOverlay = true,
  sharedToolbar = false,
) {
  const overlay =
    desktop &&
    windowControlsOverlay &&
    (platform === "win32" || platform === "darwin");
  const titleBarHeight = overlay && !fullScreen ? DESKTOP_TITLE_BAR_HEIGHT : 0;
  const integratedToolbar = overlay && sharedToolbar;
  const titleBarInset =
    titleBarHeight && platform === "win32"
      ? `env(titlebar-area-height, ${titleBarHeight}px)`
      : `${titleBarHeight}px`;
  return {
    fullScreen,
    titleBarHeight,
    titleBarInset,
    integratedToolbar,
    contentTopInset: integratedToolbar ? "0px" : titleBarInset,
    controlsSafeInset:
      !integratedToolbar || fullScreen
        ? "0px"
        : platform === "darwin"
          ? "80px"
          : "max(138px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))",
    controlsSide: !desktop
      ? "none"
      : platform === "darwin"
        ? "left"
        : platform === "win32"
          ? "right"
          : "system",
    macTrafficLightsWidth:
      overlay && platform === "darwin" && !fullScreen ? 80 : 0,
  } as const;
}

export function desktopWindowChrome(fullScreen = false, sharedToolbar = false) {
  const shell = typeof window === "undefined" ? undefined : window.echo;
  return resolveWindowChrome(
    shell?.platform,
    shell?.isElectron === true,
    fullScreen,
    shell?.windowControlsOverlay,
    sharedToolbar,
  );
}

export function sharesWorkspaceTitlebar(
  pathname: string,
  search: string,
): boolean {
  const embedded = new URLSearchParams(search).get("embedded");
  return (
    embedded !== "app" &&
    embedded !== "design" &&
    (pathname === "/browser" ||
      pathname === "/workspace" ||
      pathname.startsWith("/workspace/"))
  );
}
