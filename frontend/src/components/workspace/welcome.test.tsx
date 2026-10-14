import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

vi.mock("@/core/agents", () => ({
  useAgents: () => ({ agents: [] }),
}));

vi.mock("@/core/agents/active", () => ({
  useActiveAgentId: () => null,
}));

import { Welcome } from "./welcome";

describe("Welcome heading semantics", () => {
  it("leaves the page-level heading to ChatPageLayout", () => {
    renderWithProviders(<Welcome agentName="echo" />);

    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("Welcome starters", () => {
  it("fills the composer with a starter sentence", () => {
    const injected = vi.fn();
    const listen = (event: Event) => {
      if (event instanceof CustomEvent) injected(event.detail);
    };
    window.addEventListener("echo:inject-composer-images", listen);
    try {
      renderWithProviders(<Welcome agentName="echo" />, { locale: "zh-CN" });
      const starters = screen.getByRole("group", { name: "从一个例子开始" });
      expect(starters.querySelectorAll("button")).toHaveLength(4);
      screen.getByRole("button", { name: /数据分析/ }).click();
      expect(injected).toHaveBeenCalledWith({
        text: "分析这份数据，找出关键趋势并画成图表：",
      });
    } finally {
      window.removeEventListener("echo:inject-composer-images", listen);
    }
  });
});
