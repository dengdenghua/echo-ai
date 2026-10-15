import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Model } from "@/core/models/types";
import { renderWithProviders } from "@/test/harness";

import {
  hasAnsweringModel,
  opencodeServesSelection,
} from "@/core/models/readiness";

import { FirstModelHint } from "./first-model-hint";

const state = vi.hoisted(() => ({
  models: [] as Model[],
  isLoading: false,
}));
const addModel = vi.hoisted(() => vi.fn());
const connectOpencode = vi.hoisted(() => vi.fn());

vi.mock("@/core/models/hooks", () => ({
  useModels: () => ({
    models: state.models,
    isLoading: state.isLoading,
    error: null,
  }),
}));
vi.mock("@/core/models/setup", () => ({
  openCustomModelSetup: addModel,
  openOpencodeSetup: connectOpencode,
}));

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
    addModel.mockReset();
    connectOpencode.mockReset();
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
    // Free, but never without setup: the key is part of the sentence.
    expect(hint).toHaveTextContent("OpenCode Zen 有免费模型（需要 API Key）");
    fireEvent.click(screen.getByRole("button", { name: "连接 OpenCode" }));
    expect(connectOpencode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    expect(addModel).toHaveBeenCalledTimes(1);
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

  it("never shows while the selected engine can answer, or while that is checked", () => {
    state.models = [mix];
    const { unmount } = renderWithProviders(
      <FirstModelHint executionEngine="echo" engineReady />,
    );
    expect(screen.queryByTestId("first-model-hint")).toBeNull();
    unmount();
    // Readiness still loading: no line that a signed-in Codex then retracts.
    const checking = renderWithProviders(
      <FirstModelHint executionEngine="opencode" engineReady={null} />,
    );
    expect(screen.queryByTestId("first-model-hint")).toBeNull();
    checking.unmount();
    renderWithProviders(
      <FirstModelHint executionEngine="opencode" engineReady={false} />,
    );
    expect(screen.getByTestId("first-model-hint")).toBeInTheDocument();
  });

  it("knows which picks OpenCode can serve", () => {
    const zen: Model = {
      id: "big-pickle",
      name: "big-pickle",
      display_name: "Big Pickle",
      entry_id: "opencode-zen",
    };
    // Auto needs a connected Zen; a concrete catalog model runs as is.
    expect(opencodeServesSelection([mix, stub], "auto")).toBe(false);
    expect(opencodeServesSelection([mix, zen], "auto")).toBe(true);
    expect(opencodeServesSelection([mix, stub], "stub-chat")).toBe(true);
    expect(opencodeServesSelection([mix, stub], "echo-mix")).toBe(false);
    expect(opencodeServesSelection([mix], "deleted-model")).toBe(false);
  });
});
