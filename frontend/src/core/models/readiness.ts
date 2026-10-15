/**
 * What the model catalog says about who can answer, read without asking any
 * provider. The runtime checks again before a turn has any effect.
 */
import type { Model } from "./types";

/** Catalog rows that route to other models rather than answering themselves. */
const ROUTING_ONLY = new Set(["auto", "echo-mix"]);

function answers(model: Model): boolean {
  return !ROUTING_ONLY.has(model.id || model.name);
}

/** A configured model Echo's own engine can call. */
export function hasAnsweringModel(models: Model[]): boolean {
  return models.some(answers);
}

/**
 * Whether OpenCode has a model for this pick (mirrors the runtime's
 * `can_serve`): a concrete catalog model runs as is, while Auto needs a
 * connected OpenCode Zen — its free models also need a Zen API Key.
 */
export function opencodeServesSelection(
  models: Model[],
  selection: string | null | undefined,
): boolean {
  if (selection && selection !== "auto") {
    return models.some(
      (model) =>
        answers(model) &&
        [
          model.selection_id,
          model.entry_id,
          model.name,
          model.model,
          model.id,
        ].includes(selection),
    );
  }
  return models.some((model) => model.entry_id === "opencode-zen");
}
