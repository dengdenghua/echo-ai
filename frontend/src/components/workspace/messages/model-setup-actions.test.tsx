import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { isNoModelFailure, ModelSetupActions } from "./model-setup-actions";

const engines = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  mutate: vi.fn(),
}));
const openSettings = vi.hoisted(() => vi.fn());

vi.mock("@/core/engines/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEngines: () => ({ data: { engines: engines.list } }),
  useEngineAction: () => ({ mutate: engines.mutate, isPending: false }),
}));
vi.mock("@/core/events/event-bus", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitOpenSettings: openSettings,
}));

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
    engines.mutate.mockReset();
    openSettings.mockReset();
  });

  it("recognises the runtime's no-model failure", () => {
    expect(
      isNoModelFailure({ detail: "no LLM model configured — add one" }),
    ).toBe(true);
    expect(isNoModelFailure({ detail: "HTTP 401" })).toBe(false);
    expect(isNoModelFailure(null)).toBe(false);
  });

  it("offers every way to get a model instead of a retry", () => {
    engines.list = [opencode("not_installed")];
    renderWithProviders(<ModelSetupActions noModel />, { locale: "zh-CN" });
    fireEvent.click(screen.getByRole("button", { name: /安装 OpenCode/ }));
    expect(engines.mutate).toHaveBeenCalledWith(
      { id: "opencode", action: "install" },
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: /登录/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    expect(openSettings).toHaveBeenLastCalledWith("models");
    expect(screen.queryByRole("button", { name: /重试/ })).toBeNull();
  });

  it("says when OpenCode is already ready", () => {
    engines.list = [opencode("ready")];
    renderWithProviders(<ModelSetupActions noModel />, { locale: "en-US" });
    expect(
      screen.getByText("OpenCode is ready. Send again"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Install OpenCode/ }),
    ).toBeNull();
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
