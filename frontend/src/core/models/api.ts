import { apiGet, untypedApi } from "@/core/api/request";

import type { Model } from "./types";

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
  // Network and HTTP failures both mean "no official catalog"; a malformed
  // 2xx body still throws, as before.
  const officialResponse = await untypedApi
    .fetch("get", "/api/oct/openai/v1/models", {
      reason:
        "the oct OpenAI-compat models route is not in the OpenAPI snapshot",
    })
    .catch(() => null);
  const official = officialResponse ? await officialResponse.json() : null;
  const officialRows: Model[] = Array.isArray(official?.data)
    ? official.data
        .filter(
          (row: { id: string }) => row.id && row.id.toLowerCase() !== "auto",
        )
        .map(
          (row: {
            id: string;
            display_name?: string;
            multiplier?: string;
            recommended?: boolean;
          }) => ({
            id: `official/${row.id}`,
            name: `official/${row.id}`,
            model: `official/${row.id}`,
            selection_id: `official/${row.id}`,
            entry_id: "official",
            provider: "oct",
            display_name: row.display_name || row.id,
            source_display_name: "官方模型",
            official: true,
            multiplier: row.multiplier,
            recommended: row.recommended,
          }),
        )
    : [];
  return [...(models ?? []), ...officialRows];
}
