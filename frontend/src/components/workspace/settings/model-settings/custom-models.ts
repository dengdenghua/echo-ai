// Custom-model entries as /api/config/custom-models returns them, and the
// helpers the settings page and its forms share.

export type TestStatus = "idle" | "testing" | "success" | "fail";

export interface ModelConfig {
  id?: string;
  name: string;
  /** Open-ended list of upstream model ids this entry can dispatch
   *  to. Index 0 is the picker default, index -1 is the strongest
   *  slot for Auto mode's performance verdict. Backend stores this
   *  as ``models`` on the custom-model entry. */
  models: string[];
  selection_ids?: string[];
  display_name?: string | null;
  description?: string | null;
  provider?: string | null;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  base_url?: string;
  has_api_key?: boolean;
  default_header_names?: string[];
  has_default_headers?: boolean;
  max_tokens?: number | null;
  context_window?: number | null;
  enable_1m_context?: boolean;
}

export function customModelReferences(model: ModelConfig): string[] {
  return Array.from(
    new Set(
      [model.name, model.id, ...model.models, ...(model.selection_ids ?? [])]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export function customModelEntryId(model: ModelConfig): string {
  return model.id?.trim() || model.name.trim();
}

export function customModelMatchesIdentity(
  model: ModelConfig,
  identity: string,
): boolean {
  const normalized = identity.trim();
  return Boolean(
    normalized &&
    (customModelEntryId(model) === normalized ||
      model.name.trim() === normalized),
  );
}

export function customModelMatchesSelection(
  model: ModelConfig,
  selection?: string | null,
): boolean {
  const normalized = selection?.trim();
  return Boolean(
    normalized && customModelReferences(model).includes(normalized),
  );
}

export function customModelPreferredSelection(model: ModelConfig): string {
  return (
    model.selection_ids?.find((value) => value.trim())?.trim() ||
    model.models.find((value) => value.trim())?.trim() ||
    customModelEntryId(model)
  );
}

// Parse `Header-Name: value` lines into a dict. Blank lines and lines
// lacking a colon are ignored so users can leave helper comments.
export function parseHeadersText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

// Mirror of the backend base_url guard (config_router._validate_base_url)
// for instant feedback before the network round-trip. Loopback / private
// hosts stay allowed (local servers like Ollama / LM Studio); only
// non-http(s) schemes and link-local / cloud-metadata endpoints are
// rejected. Returns an error reason, or null when acceptable (empty
// included — the backend owns the per-provider "required" check).
export function validateBaseUrl(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid base_url: unparseable URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `invalid base_url: scheme must be http/https (got ${parsed.protocol.replace(":", "")})`;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "metadata.google.internal" || host === "metadata.goog") {
    return "invalid base_url: blocked cloud-metadata host";
  }
  if (/^169\.254\./.test(host) || host.startsWith("fe80:")) {
    return "invalid base_url: blocked link-local address";
  }
  return null;
}

export const LOCAL_MODEL_SCAN_EVENT = "echo:model-settings:scan-local";
