/**
 * Model-picker selection logic: the pure "which model does this value mean"
 * helpers, split out of `model-picker.tsx` so the component file stays under
 * the 1000-line god-file ratchet. No JSX, no hooks — safe to unit-test alone.
 */

import { DEFAULT_CONTEXT_WINDOW_TOKENS } from "@/core/models/context-window";
import type { ReasoningEffort } from "@/core/threads";

/** Minimal slice of the backend model shape used by the picker. */
export interface PickerModel {
  id?: string | null;
  name: string;
  display_name?: string | null;
  source_display_name?: string | null;
  description?: string | null;
  entry_id?: string | null;
  selection_id?: string | null;
  model?: string | null;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_tool_use?: boolean;
  is_free?: boolean;
  supports_reasoning_effort?: boolean;
  /** UI effort tiers this model genuinely accepts. undefined/null = full
   *  default set; [] = no meaningful effort control (picker hides it). */
  reasoning_efforts?: ReasoningEffort[] | null;
  context_window?: number | null;
  context_profile?: string | null;
  [key: string]: unknown;
}

export function selectionValue(model: PickerModel): string {
  return model.selection_id || model.entry_id || model.name;
}

export function isFreePickerModel(model: PickerModel | undefined): boolean {
  // A provider name is not a price guarantee. Unknown or explicitly paid
  // models must not inherit the free styling from their Zen connection.
  return model?.is_free === true;
}

/** Compare series releases and keep the two newest numbered generations per family. */
export function partitionModelReleases(
  models: PickerModel[],
  value?: string | null,
) {
  const releases = models.map((model) => {
    const name = (model.model || model.name).toLowerCase();
    const match = name.match(
      /^(claude-(?:opus|sonnet|haiku|fable)-|gpt-|gemini-|grok-|glm-|kimi-k|minimax-m|muse-spark-|qwen|deepseek-v|mimo-v|nemotron-|ling-)([0-9]+(?:[.-][0-9]+)*)(.*)$/,
    );
    return {
      model,
      generationKey: match
        ? [
            model.entry_id || "",
            match[1]!.startsWith("claude-") ? "claude" : match[1],
            Boolean(model.is_free),
          ].join(":")
        : null,
      key: match
        ? [
            model.entry_id || "",
            match[1],
            match[3],
            Boolean(model.is_free),
          ].join(":")
        : null,
      version: match ? match[2]!.split(/[.-]/).map(Number) : [],
    };
  });
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] || 0) - (b[i] || 0);
      if (delta) return delta;
    }
    return 0;
  };
  const latest = new Map<string, number[]>();
  const generations = new Map<string, number[][]>();
  for (const item of releases) {
    if (!item.generationKey) continue;
    const versions = generations.get(item.generationKey) || [];
    if (!versions.some((version) => compare(version, item.version) === 0)) {
      versions.push(item.version);
      versions.sort((a, b) => compare(b, a));
    }
    generations.set(item.generationKey, versions);
  }
  for (const item of releases)
    if (
      item.key &&
      (!latest.has(item.key) ||
        compare(item.version, latest.get(item.key)!) > 0)
    )
      latest.set(item.key, item.version);
  const current: PickerModel[] = [],
    older: PickerModel[] = [];
  for (const item of releases) {
    const hidden =
      ((item.key && compare(item.version, latest.get(item.key)!) < 0) ||
        (item.generationKey &&
          generations
            .get(item.generationKey)!
            .findIndex((version) => compare(version, item.version) === 0) >=
            2)) &&
      !modelMatchesValue(item.model, value);
    (hidden ? older : current).push(item.model);
  }
  return { current, older };
}

export function deduplicatePickerModels(models: PickerModel[]): PickerModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (model.context_profile === "1m") return false;
    const key = selectionValue(model);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function longContextSelectionValue(model: PickerModel): string {
  // Older catalogs have no selection_id; their routable 1M alias is the
  // ``variant::1m`` name, not the entry id (which means the default profile).
  return model.selection_id || model.name;
}

export function modelFamilyKey(model: PickerModel): string {
  if (model.entry_id && model.model) {
    return `${model.entry_id}\u0000${model.model}`;
  }
  return model.name.replace(/::1m$/, "");
}

export function modelMatchesValue(
  model: PickerModel,
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  return [
    model.selection_id,
    model.entry_id,
    model.name,
    model.model,
    model.id,
  ].includes(value);
}

export function contextSelectionValue(model: PickerModel): string {
  return model.context_profile === "1m"
    ? longContextSelectionValue(model)
    : selectionValue(model);
}

export function contextWindowTokens(model: PickerModel): number {
  const explicit = Number(model.context_window);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return model.context_profile === "1m"
    ? 1_000_000
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return tokens.toLocaleString();
}
