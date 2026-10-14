/** Extension store pages the desktop app can install from. */

export type ExtensionStore = "chrome" | "edge";

export const EXTENSION_STORE_HOME: Record<ExtensionStore, string> = {
  chrome: "https://chromewebstore.google.com/category/extensions",
  edge: "https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home",
};

export const EXTENSION_STORE_NAME: Record<ExtensionStore, string> = {
  chrome: "Chrome 应用店",
  edge: "Edge 加载项",
};

const EXTENSION_ID = /^[a-p]{32}$/;

/** The extension behind a store detail page, or null for any other page. */
export function storeExtensionPage(
  url: string | undefined,
): { store: ExtensionStore; id: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const id = parts.at(-1) ?? "";
  if (!EXTENSION_ID.test(id)) return null;
  if (parsed.hostname === "chromewebstore.google.com" && parts[0] === "detail")
    return { store: "chrome", id };
  if (
    parsed.hostname === "microsoftedge.microsoft.com" &&
    parts[0] === "addons" &&
    parts[1] === "detail"
  )
    return { store: "edge", id };
  return null;
}
