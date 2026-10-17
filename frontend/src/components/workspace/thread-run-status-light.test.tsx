import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { agentRunRobotButtonClass } from "./agent-run-status";
import { ThreadRunStatusLight } from "./thread-run-status-light";

describe("<ThreadRunStatusLight />", () => {
  it("shows a session that only lacks a model as a neutral setup state", () => {
    renderWithProviders(<ThreadRunStatusLight status="setup" />, {
      locale: "zh-CN",
    });

    const light = screen.getByRole("img", { name: "待连接模型" });
    expect(light.innerHTML).toContain("bg-muted-foreground");
    expect(light.innerHTML).not.toMatch(/bg-destructive|bg-warning/);
    // No pulse: nothing is running or waiting.
    expect(light.innerHTML).not.toMatch(/animate-/);
  });

  it("keeps the failure colour for a real failure", () => {
    renderWithProviders(<ThreadRunStatusLight status="error" />, {
      locale: "zh-CN",
    });

    const light = screen.getByRole("img", { name: "异常待处理" });
    expect(light.innerHTML).toContain("bg-destructive");
  });

  it("gives 主电脑 a neutral frame while it waits for a model", () => {
    expect(agentRunRobotButtonClass("setup")).toBe(
      "border-border-default bg-muted/35",
    );
  });
});
