interface PackagedShellWindow {
  location: { protocol: string };
  echo?: { isElectron?: boolean };
}

export function isPackagedShell(
  shellWindow: PackagedShellWindow | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  return (
    !!shellWindow?.echo?.isElectron &&
    shellWindow.location.protocol === "echo-app:"
  );
}
