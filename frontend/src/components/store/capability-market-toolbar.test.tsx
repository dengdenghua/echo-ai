import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";

import { CapabilityMarketToolbar } from "./capability-market-toolbar";

describe("CapabilityMarketToolbar", () => {
  it("offers one 全部 filter, not 全部 and 全部类型 side by side", () => {
    const onTypeFilterChange = vi.fn();
    renderWithProviders(
      <CapabilityMarketToolbar
        typeFilter="all"
        onTypeFilterChange={onTypeFilterChange}
        counts={{ all: 9, mcp: 4, cli: 1, "skill-only": 3, plugin: 1 }}
        visibleCount={9}
        totalCount={9}
        query=""
        onQueryChange={vi.fn()}
        showManual={false}
        onToggleManual={vi.fn()}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^全部/ })).toHaveLength(1);
    expect(screen.queryByText("全部类型")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "全部9" }).click();
    expect(onTypeFilterChange).toHaveBeenCalledWith("all");
  });
});
