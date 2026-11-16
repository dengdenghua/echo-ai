const STORAGE_KEY = "echo:desktop-sidebar-open";

export function readDesktopSidebarOpen(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "true" || saved === "false") return saved === "true";
  } catch {
    // Restricted browser storage still supports the older cookie preference.
  }
  try {
    return !document.cookie
      .split(";")
      .some((part) => part.trim() === "sidebar_state=false");
  } catch {
    return true;
  }
}

export function saveDesktopSidebarOpen(open: boolean): void {
  try {
    // The packaged echo-app origin cannot persist document.cookie. Store the
    // choice synchronously so an immediate reload also restores full collapse.
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // The current window remains usable when persistence is restricted.
  }
}
