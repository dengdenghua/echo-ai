import { selectionValue, type PickerModel } from "./model-picker-selection";

export type ModelEngine = "echo" | "codex" | "opencode" | "codebuddy";
export interface RoutedPickerModel extends PickerModel {
  executionEngine: ModelEngine;
  wireModel: string;
}

/** UI identities include the engine; wire identities remain owned by their provider. */
export function routedModel(
  engine: ModelEngine,
  wireModel: string,
  model: PickerModel,
  source: string,
): RoutedPickerModel {
  return {
    ...model,
    entry_id: `${engine}:${model.entry_id || wireModel}`,
    model: model.model || model.name,
    selection_id: JSON.stringify([engine, wireModel]),
    source_display_name: source,
    executionEngine: engine,
    wireModel,
  };
}

export function routeNativeModels(models: PickerModel[]): RoutedPickerModel[] {
  return models.map((model) => {
    const openCode = ["opencode-zen", "opencode-go"].includes(
      model.entry_id ?? "",
    );
    return routedModel(
      openCode ? "opencode" : "echo",
      selectionValue(model),
      model,
      openCode
        ? `OpenCode ${model.entry_id === "opencode-go" ? "Go" : "Zen"}`
        : model.source_display_name || "Echo",
    );
  });
}
