import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { UnifiedModelControl } from "./unified-model-control";
import { routeNativeModels, routedModel } from "./unified-model-catalog";
import type * as RequestModule from "@/core/api/request";
import type * as CoderApiModule from "@/core/coder/api";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  account: vi.fn(),
  profile: vi.fn(),
  models: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: null, isLoading: false }),
}));
vi.mock("@/core/api/request", async (original) => ({
  ...(await original<typeof RequestModule>()),
  apiGet: api.get,
}));
vi.mock("@/core/coder/api", async (original) => ({
  ...(await original<typeof CoderApiModule>()),
  getCoderAccount: api.account,
  getCoderModelProfile: api.profile,
  getCoderModels: api.models,
  updateCoderModelProfile: api.save,
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ models: ["hy3"] });
  api.account.mockResolvedValue({ account: { type: "chatgpt" } });
  api.profile.mockResolvedValue({
    source: "codex_account",
    selected_model: "gpt-test",
    effective_model: "gpt-test",
  });
  api.models.mockResolvedValue({
    models: [
      { id: "gpt-test", display_name: "GPT test", reasoning_efforts: [] },
    ],
  });
  api.save.mockResolvedValue({
    source: "codex_account",
    selected_model: "gpt-test",
    effective_model: "gpt-test",
  });
});

it("routes the same upstream ID by its source and preserves endpoint identities", () => {
  const native = routeNativeModels([
    { name: "same", entry_id: "mine", selection_id: "mine::1m" },
    { name: "same", entry_id: "opencode-zen" },
  ]);
  const official = routedModel(
    "codebuddy",
    "codebuddy/same",
    { name: "same" },
    "CodeBuddy",
  );
  expect(native.map((row) => [row.executionEngine, row.wireModel])).toEqual([
    ["echo", "mine::1m"],
    ["opencode", "opencode-zen"],
  ]);
  expect(
    new Set([...native, official].map((row) => row.selection_id)).size,
  ).toBe(3);
});

it("selects an official model and binds CodeBuddy without touching the Codex profile", async () => {
  const onEngineChange = vi.fn(),
    onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <UnifiedModelControl
      engine="echo"
      models={[]}
      onEngineChange={onEngineChange}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByTestId("unified-model-trigger"));
  expect(screen.queryByRole("button", { name: /^(All|全部)$/ })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Echo", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("hy3")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "CodeBuddy", exact: true }),
  );
  await user.click(await screen.findByText("hy3"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("codebuddy/hy3"));
  expect(onEngineChange).toHaveBeenCalledWith("codebuddy");
  expect(api.save).not.toHaveBeenCalled();
});

it("publishes a Codex switch only after its server profile is saved", async () => {
  const onEngineChange = vi.fn(),
    onChange = vi.fn();
  const user = userEvent.setup();
  api.save.mockRejectedValueOnce(new Error("save failed"));
  renderWithProviders(
    <UnifiedModelControl
      engine="codebuddy"
      value="codebuddy/hy3"
      models={[]}
      onEngineChange={onEngineChange}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByTestId("unified-model-trigger"));
  await user.click(screen.getByRole("button", { name: "Codex", exact: true }));
  await user.click(await screen.findByText("GPT test"));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith({
      source: "codex_account",
      model: "gpt-test",
    }),
  );
  expect(onEngineChange).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("unified-model-trigger"));
  await user.click(screen.getByRole("button", { name: "Codex", exact: true }));
  await user.click(await screen.findByText("GPT test"));
  await waitFor(() => expect(onEngineChange).toHaveBeenCalledWith("codex"));
  expect(onChange).toHaveBeenCalledWith("gpt-test");
});

it("describes an empty official catalog without calling it a custom-model list", async () => {
  api.get.mockResolvedValue({ models: [] });
  const user = userEvent.setup();
  renderWithProviders(
    <UnifiedModelControl engine="echo" models={[]} onEngineChange={vi.fn()} />,
  );
  await user.click(screen.getByTestId("unified-model-trigger"));
  await user.click(
    screen.getByRole("button", { name: "CodeBuddy", exact: true }),
  );
  expect(
    await screen.findByText(
      /Could not load CodeBuddy official models|未能读取 CodeBuddy 官方模型/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/No custom models|没有自定义模型/),
  ).not.toBeInTheDocument();
});
