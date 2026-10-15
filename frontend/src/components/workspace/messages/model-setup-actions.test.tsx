import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { isNoModelFailure, ModelSetupActions } from "./model-setup-actions";

const engines = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));
const openSettings = vi.hoisted(() => vi.fn());
const addModel = vi.hoisted(() => vi.fn());

vi.mock("@/core/engines/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEngines: () => ({ data: { engines: engines.list } }),
}));
vi.mock("@/core/events/event-bus", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitOpenSettings: openSettings,
}));
vi.mock("@/core/models/setup", () => ({ openCustomModelSetup: addModel }));

const opencode = (state: string) => ({
  id: "opencode",
  state,
  supported: true,
  version: "1.0.0",
  download_size: 42_000_000,
  job: null,
});

describe("ModelSetupActions", () => {
  afterEach(() => {
    engines.list = [];
    openSettings.mockReset();
    addModel.mockReset();
  });

  it("recognises the runtime's no-model failure", () => {
    expect(
      isNoModelFailure({ detail: "no LLM model configured — add one" }),
    ).toBe(true);
    expect(isNoModelFailure({ detail: "HTTP 401" })).toBe(false);
    expect(isNoModelFailure(null)).toBe(false);
  });

  it("offers to add a model, never a free one, instead of a retry", () => {
    engines.list = [opencode("not_installed")];
    renderWithProviders(<ModelSetupActions noModel />, { locale: "zh-CN" });
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    expect(addModel).toHaveBeenCalledTimes(1);
    // OpenCode cannot answer until it is installed and connected.
    expect(screen.queryByRole("button", { name: /OpenCode/ })).toBeNull();
    expect(screen.queryByText(/免费/)).toBeNull();
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
  });

  it("offers to connect OpenCode once the engine is installed", () => {
    engines.list = [opencode("ready")];
    renderWithProviders(<ModelSetupActions noModel />, { locale: "en-US" });
    fireEvent.click(screen.getByRole("button", { name: "Connect OpenCode" }));
    expect(openSettings).toHaveBeenLastCalledWith("models");
    expect(screen.getByRole("button", { name: "Add a model" })).toBeVisible();
  });

  it("keeps the single settings action for other model problems", () => {
    renderWithProviders(<ModelSetupActions noModel={false} />, {
      locale: "en-US",
    });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button"));
    expect(openSettings).toHaveBeenLastCalledWith("models");
  });
});
