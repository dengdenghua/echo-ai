import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Model } from "@/core/models/types";
import { renderWithProviders } from "@/test/harness";

import { FirstModelHint, hasAnsweringModel } from "./first-model-hint";

const state = vi.hoisted(() => ({
  models: [] as Model[],
  isLoading: false,
  engines: [] as Array<Record<string, unknown>>,
}));
const addModel = vi.hoisted(() => vi.fn());

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: state.models,
    isLoading: state.isLoading,
    error: null,
  }),
}));
vi.mock("@/core/engines/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEngines: () => ({ data: { engines: state.engines } }),
}));
vi.mock("@/core/models/setup", () => ({ openCustomModelSetup: addModel }));

const mix: Model = { id: "echo-mix", name: "echo-mix", display_name: "mix" };
const stub: Model = {
  id: "stub-chat",
  name: "stub-chat",
  display_name: "Stub",
  entry_id: "stub",
};

describe("FirstModelHint", () => {
  afterEach(() => {
    state.models = [];
    state.isLoading = false;
    state.engines = [];
    addModel.mockReset();
  });

  it("treats routing-only rows as no model", () => {
    expect(hasAnsweringModel([])).toBe(false);
    expect(hasAnsweringModel([mix])).toBe(false);
    expect(hasAnsweringModel([mix, stub])).toBe(true);
  });

  it("asks a new user to connect a model before the first turn", () => {
    state.models = [mix];
    renderWithProviders(<FirstModelHint />, { locale: "zh-CN" });
    const hint = screen.getByTestId("first-model-hint");
    expect(hint).toHaveTextContent("先连接一个模型");
    expect(hint).not.toHaveTextContent("免费");
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    expect(addModel).toHaveBeenCalledTimes(1);
    // OpenCode is not installed, so it cannot answer: no button for it.
    expect(screen.queryByRole("button", { name: /OpenCode/ })).toBeNull();
  });

  it("offers OpenCode only once the engine is installed", () => {
    state.engines = [{ id: "opencode", state: "ready" }];
    renderWithProviders(<FirstModelHint />, { locale: "zh-CN" });
    expect(
      screen.getByRole("button", { name: "连接 OpenCode" }),
    ).toBeInTheDocument();
  });

  it("stays out of the way when a model exists, while loading, or on Codex", () => {
    state.models = [mix, stub];
    const { unmount } = renderWithProviders(<FirstModelHint />);
    expect(screen.queryByTestId("first-model-hint")).toBeNull();
    unmount();
    state.models = [];
    state.isLoading = true;
    renderWithProviders(<FirstModelHint />).unmount();
    expect(screen.queryByTestId("first-model-hint")).toBeNull();
    state.isLoading = false;
    renderWithProviders(<FirstModelHint executionEngine="codex" />);
    expect(screen.queryByTestId("first-model-hint")).toBeNull();
  });
});
