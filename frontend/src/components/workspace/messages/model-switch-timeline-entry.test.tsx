import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { ModelSwitchTimelineEntry } from "./model-switch-timeline-entry";

describe("ModelSwitchTimelineEntry", () => {
  it("renders a quiet centered model-change status", () => {
    renderWithProviders(<ModelSwitchTimelineEntry modelName="gpt-5.6-sol" />);

    const entry = screen.getByRole("status", {
      name: "Model switched to gpt-5.6-sol",
    });
    expect(entry).toHaveTextContent("Model switched to gpt-5.6-sol");
    expect(entry.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("follows the UI language", () => {
    renderWithProviders(<ModelSwitchTimelineEntry modelName="gpt-5.6-sol" />, {
      locale: "zh-CN",
    });

    expect(
      screen.getByRole("status", { name: "模型已切换为 gpt-5.6-sol" }),
    ).toHaveTextContent("模型已切换为 gpt-5.6-sol");
  });
});
