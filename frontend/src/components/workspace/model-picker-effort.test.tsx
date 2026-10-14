/**
 * Tests for the chat-input model picker — reasoning-effort control.
 *
 * Split from model-picker.test.tsx (god-file ratchet); the effort tiers live
 * inside the model dropdown, so these render the full picker.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AllProviders } from "@/test/harness";

import { ModelPicker, type PickerModel } from "./model-picker";

// Stub useOctLink — picker reads `link.oct_user_id` to auto-enable
// unconfigured models.
vi.mock("@/core/oct/hooks", () => ({
  useOctLink: () => ({ data: null }),
}));

function withRouter(node: React.ReactNode) {
  // Test assertions reference zh-CN copy, so prime the I18nProvider to zh-CN.
  return <AllProviders locale="zh-CN">{node}</AllProviders>;
}

const MODELS: PickerModel[] = [
  { name: "echo-mix", display_name: "mix", provider: "echo" },
  { name: "kimi-k2.5", display_name: "Kimi K2.5", model: "kimi" },
  { name: "minimax-m2.7", display_name: "MiniMax M2.7", model: "minimax" },
  { name: "glm-5", display_name: "GLM-5", model: "glm" },
  { name: "deepseek-v3.2", display_name: "DeepSeek-V3.2", model: "deepseek" },
  { name: "qwen3-max", display_name: "Qwen3-Max", model: "qwen" },
  {
    name: "claude-opus-4-6-mirror",
    display_name: "Claude Opus 4.6 (mirror)",
    model: "claude-opus",
    description: "Anthropic Opus via mirror",
  },
];

describe("<ModelPicker /> reasoning effort", () => {
  it("keeps reasoning effort inside the model dropdown", async () => {
    const user = userEvent.setup();
    const onReasoningEffortChange = vi.fn();
    render(
      withRouter(
        <ModelPicker
          models={MODELS.map((model) => ({
            ...model,
            reasoning_efforts: ["medium", "high", "xhigh"],
          }))}
          value="kimi-k2.5"
          onChange={vi.fn()}
          reasoningEffort="medium"
          onReasoningEffortChange={onReasoningEffortChange}
        />,
      ),
    );

    await user.click(screen.getByRole("button", { name: "选择模型" }));
    const group = await screen.findByRole("radiogroup", {
      name: "推理等级",
    });

    expect(within(group).getByRole("radio", { name: "中" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(within(group).getByRole("radio", { name: "超高" }));

    expect(onReasoningEffortChange).toHaveBeenCalledWith("xhigh");
  });

  it("only offers the effort tiers the selected model genuinely supports", async () => {
    const user = userEvent.setup();
    render(
      withRouter(
        <ModelPicker
          models={[
            {
              name: "deepseek-v4",
              model: "deepseek-v4",
              display_name: "DeepSeek V4",
              reasoning_efforts: ["off", "high", "xhigh"],
            },
          ]}
          value="deepseek-v4"
          onChange={vi.fn()}
          reasoningEffort="medium"
          onReasoningEffortChange={vi.fn()}
        />,
      ),
    );

    await user.click(screen.getByRole("button", { name: "选择模型" }));
    const group = await screen.findByRole("radiogroup", {
      name: "推理等级",
    });
    const radios = within(group).getAllByRole("radio");
    // Only off / high / xhigh — the low/medium tiers DeepSeek collapses
    // onto "high" on the wire are not offered.
    expect(radios.map((r) => r.textContent)).toEqual(["关闭", "高", "超高"]);
  });

  it("hides the effort control when the model has no meaningful tiers", async () => {
    const user = userEvent.setup();
    render(
      withRouter(
        <ModelPicker
          models={[
            {
              name: "minimax-m2",
              model: "minimax-m2",
              display_name: "MiniMax M2",
              reasoning_efforts: [],
            },
          ]}
          value="minimax-m2"
          onChange={vi.fn()}
          reasoningEffort="medium"
          onReasoningEffortChange={vi.fn()}
        />,
      ),
    );

    await user.click(screen.getByRole("button", { name: "选择模型" }));
    expect(
      screen.queryByRole("radiogroup", { name: "推理等级" }),
    ).not.toBeInTheDocument();
  });

  it("shows a mapping hint when the current effort is not offered", async () => {
    const user = userEvent.setup();
    render(
      withRouter(
        <ModelPicker
          models={[
            {
              name: "deepseek-v4",
              model: "deepseek-v4",
              display_name: "DeepSeek V4",
              reasoning_efforts: ["off", "high", "xhigh"],
            },
          ]}
          value="deepseek-v4"
          onChange={vi.fn()}
          reasoningEffort="medium"
          onReasoningEffortChange={vi.fn()}
        />,
      ),
    );

    await user.click(screen.getByRole("button", { name: "选择模型" }));
    const menu = await screen.findByTestId("model-picker-menu");
    // "中" isn't offered for DeepSeek — it maps to "高" on the wire, and the
    // UI surfaces that instead of silently rewriting it.
    expect(within(menu).getByText(/将按.*高.*发送/)).toBeInTheDocument();
    expect(within(menu).getByRole("radio", { name: "高" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
