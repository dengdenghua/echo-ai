// Slash-command catalog client. Backend assembles global
// (~/.echo/commands/) + project-local entries; this just
// fetches the merged list so the composer typeahead can render
// it. Body text never crosses the wire — the picker only needs
// metadata (name / description / argument hint).

import { EchoAPIError, apiGet } from "@/core/api/request";
import type { components } from "@/core/api/openapi-types";

export type SlashCommand = components["schemas"]["SlashCommandWire"];

export async function listSlashCommands(): Promise<{
  commands: SlashCommand[];
}> {
  try {
    return await apiGet("/api/slash-commands");
  } catch (error) {
    // Any HTTP failure degrades to an empty catalog.
    if (error instanceof EchoAPIError) return { commands: [] };
    throw error;
  }
}
