/** Canonical homes for operational features that used to occupy the Tools group. */
export const COMPUTER_CONTROL_ROUTE =
  "/workspace/storage?surface=company&library=computer&view=control";
export const DESKTOP_ORGANIZER_ROUTE =
  "/workspace/storage?surface=company&library=computer&view=organizer";
export const MESSAGE_CHANNELS_ROUTE =
  "/workspace/settings?section=tools&toolsTab=channels";
export const REFLEX_RULES_ROUTE =
  "/workspace/evolution?section=governance&detail=reflex";
export const RUNTIME_DIAGNOSTICS_ROUTE = "/workspace/observability?tab=system";

const legacyDestinations: Readonly<Record<string, string>> = {
  "/workspace/computer": COMPUTER_CONTROL_ROUTE,
  "/workspace/desktop-organizer": DESKTOP_ORGANIZER_ROUTE,
  "/workspace/channels": MESSAGE_CHANNELS_ROUTE,
  "/workspace/reflex": REFLEX_RULES_ROUTE,
  "/workspace/diagnostics": RUNTIME_DIAGNOSTICS_ROUTE,
};

/** Keep unrelated query context while selecting the feature in its new home. */
export function workspaceUtilityDestination(
  pathname: string,
  search = "",
): string | null {
  const destination = legacyDestinations[pathname];
  if (!destination) return null;
  const [path, targetSearch] = destination.split("?");
  const params = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(targetSearch)) {
    params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}
