// OpenAI-compatible profile diagnostics (/api/config/custom-models/
// compat-diagnostics and /api/config/openai-compat-profiles) and the
// summaries the diagnostics sections render.

interface CompatDiagnosticUpstream {
  model: string;
  profile?: string | null;
  profile_display_name?: string | null;
  profile_summary?: {
    id?: string;
    display_name?: string;
    compat_score?: number;
    normalization_hints?: string[];
    notes?: string[];
  };
  compat_score?: number | null;
  normalization_hints?: string[];
  compatibility_notes?: string[];
  normalization?: {
    removed_fields?: string[];
    added_fields?: string[];
    changed_fields?: string[];
    normalized_fields?: string[];
  };
  fallback_retries?: Array<{
    reason?: string;
    removed_fields?: string[];
    added_fields?: string[];
    changed_fields?: string[];
  }>;
}

export interface CompatDiagnostic {
  id: string;
  provider?: string | null;
  applicable: boolean;
  reason?: string | null;
  has_api_key?: boolean;
  default_header_names?: string[];
  built_in?: boolean;
  sample_base_url?: string;
  upstreams?: CompatDiagnosticUpstream[];
}

export type CompatDiagnosticState =
  | { status: "idle" | "loading"; byId: Record<string, CompatDiagnostic> }
  | { status: "ready"; byId: Record<string, CompatDiagnostic> }
  | { status: "error"; byId: Record<string, CompatDiagnostic>; error: string };

export type CompatProfileCatalogState =
  | { status: "idle" | "loading"; items: CompatDiagnostic[] }
  | { status: "ready"; items: CompatDiagnostic[] }
  | { status: "error"; items: CompatDiagnostic[]; error: string };

export function collectCompatFields(
  diagnostic: CompatDiagnostic | undefined,
  key: "removed_fields" | "added_fields" | "changed_fields",
): string[] {
  const seen = new Set<string>();
  for (const upstream of diagnostic?.upstreams ?? []) {
    const values = upstream.normalization?.[key] ?? [];
    for (const value of values) {
      if (typeof value === "string" && value.trim()) seen.add(value);
    }
  }
  return Array.from(seen).sort();
}

export function countCompatRetries(
  diagnostic: CompatDiagnostic | undefined,
): number {
  return (diagnostic?.upstreams ?? []).reduce(
    (total, upstream) =>
      total +
      (Array.isArray(upstream.fallback_retries)
        ? upstream.fallback_retries.length
        : 0),
    0,
  );
}

export function summarizeCompatProfiles(
  diagnostic: CompatDiagnostic | undefined,
): string[] {
  const seen = new Set<string>();
  for (const upstream of diagnostic?.upstreams ?? []) {
    const label = upstream.profile_display_name || upstream.profile;
    if (typeof label === "string" && label.trim()) seen.add(label);
  }
  return Array.from(seen);
}

export function summarizeCompatRetryReasons(
  diagnostic: CompatDiagnostic | undefined,
): string[] {
  const seen = new Set<string>();
  for (const upstream of diagnostic?.upstreams ?? []) {
    for (const retry of upstream.fallback_retries ?? []) {
      if (retry.reason) seen.add(retry.reason);
    }
  }
  return Array.from(seen).sort();
}

export function summarizeCompatScoreRange(
  diagnostic: CompatDiagnostic | undefined,
): { min: number; max: number } | null {
  const scores: number[] = [];
  for (const upstream of diagnostic?.upstreams ?? []) {
    const candidates = [
      upstream.compat_score,
      upstream.profile_summary?.compat_score,
    ];
    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        scores.push(Math.round(value));
      }
    }
  }
  if (scores.length === 0) return null;
  return {
    min: Math.min(...scores),
    max: Math.max(...scores),
  };
}

export function collectCompatProfileText(
  diagnostic: CompatDiagnostic | undefined,
  key: "normalization_hints" | "compatibility_notes",
): string[] {
  const seen = new Set<string>();
  for (const upstream of diagnostic?.upstreams ?? []) {
    const direct =
      key === "normalization_hints"
        ? upstream.normalization_hints
        : upstream.compatibility_notes;
    const summary =
      key === "normalization_hints"
        ? upstream.profile_summary?.normalization_hints
        : upstream.profile_summary?.notes;
    for (const value of [...(direct ?? []), ...(summary ?? [])]) {
      if (typeof value === "string" && value.trim()) seen.add(value);
    }
  }
  return Array.from(seen).sort();
}
