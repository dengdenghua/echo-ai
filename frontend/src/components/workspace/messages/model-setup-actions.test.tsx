import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { isNoModelFailure, ModelSetupActions } from "./model-setup-actions";

const openSettings = vi.hoisted(() => vi.fn());
const addModel = vi.hoisted(() => vi.fn());
const connectOpencode = vi.hoisted(() => vi.fn());

vi.mock("@/core/events/event-bus", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitOpenSettings: openSettings,
}));
vi.mock("@/core/models/setup", () => ({
  openCustomModelSetup: addModel,
  openOpencodeSetup: connectOpencode,
}));

describe("ModelSetupActions", () => {
  afterEach(() => {
    openSettings.mockReset();
    addModel.mockReset();
    connectOpencode.mockReset();
  });

  it("recognises the runtime's no-model failure", () => {
    expect(
      isNoModelFailure({ detail: "no LLM model configured — add one" }),
    ).toBe(true);
    expect(isNoModelFailure({ detail: "HTTP 401" })).toBe(false);
    expect(isNoModelFailure(null)).toBe(false);
  });

  it("offers OpenCode's free models with a key, or the user's own model", () => {
    renderWithProviders(<ModelSetupActions noModel />, { locale: "zh-CN" });
    const connect = screen.getByRole("button", { name: "连接 OpenCode" });
    expect(connect).toHaveAttribute(
      "title",
      "免费模型，需连接 OpenCode Zen 并填入 API Key",
    );
    fireEvent.click(connect);
    expect(connectOpencode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    expect(addModel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
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
