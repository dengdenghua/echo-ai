import { apiGet } from "@/core/api/request";

import type { Model } from "./types";

/** Hosted "official" models were removed from the product; drop any row the
 *  backend still advertises under that route so no picker can select one. */
function isOfficialModel(model: Model): boolean {
  return (
    model.entry_id === "official" ||
    String(model.name ?? "").startsWith("official/")
  );
}

export async function loadModels(): Promise<Model[]> {
  // Use the LLM catalog endpoint, not /api/models — the latter aliases
  // the OpenAI-compat gateway which exposes *skills* (e.g.
  // "echo-ai/list_cwd") as "models" for external clients that
  // want to call a skill via model= routing. For the in-app
  // ModelPicker we want real LLM options (Echo Mix + configured custom models).
  const { models } = (await apiGet("/api/llm-models", {
    errorMessage: (failure) =>
      `Failed to load models: ${failure.status} ${failure.statusText}`,
  })) as { models: Model[] };
  return (models ?? []).filter((model) => !isOfficialModel(model));
}
