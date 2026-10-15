import type { CommandExecutionItem } from "@/core/realtime/items";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adapters sometimes serialize a tool's argument object into a string preview.
 * Presenters read structured arguments (``path``, ``command`` …), so a string
 * that is exactly one JSON object becomes that object. Anything else — prose,
 * a truncated preview, a JSON array — stays a string.
 */
export function parseJsonObjectText(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function previewRecord(preview: unknown): Record<string, unknown> | null {
  if (isRecord(preview)) return { ...preview };
  return parseJsonObjectText(preview);
}

export function commandExecutionToolName(item: CommandExecutionItem): string {
  return item.command || "command";
}

export function commandExecutionInput(
  item: CommandExecutionItem,
): Record<string, unknown> {
  const parsed = previewRecord(item.inputPreview);
  const input: Record<string, unknown> = parsed ?? {};
  if (item.inputPreview !== undefined && !parsed) {
    input.inputPreview = item.inputPreview;
  }
  // Codex dynamic tool calls (Echo host tools) wrap the real arguments as
  // ``{arguments, server, tool}``; ``arguments`` may itself be JSON text.
  // Lift them to the top level so presenters find ``path``/``command``.
  const nested = isRecord(input.arguments)
    ? input.arguments
    : parseJsonObjectText(input.arguments);
  if (nested) {
    input.arguments = nested;
    for (const [key, value] of Object.entries(nested)) {
      if (!(key in input)) input[key] = value;
    }
  }
  if (!("command" in input)) input.command = commandExecutionToolName(item);
  if (!("tool" in input)) input.tool = commandExecutionToolName(item);
  if (item.cwd !== null && !("cwd" in input)) input.cwd = item.cwd;
  if (!("networkAccess" in input)) input.networkAccess = item.networkAccess;
  return input;
}
