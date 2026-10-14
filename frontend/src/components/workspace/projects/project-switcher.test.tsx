import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { projectRowFromSummary, toProjectRow } from "@/core/projects/portfolio";
import { normalizePortfolioEntry } from "@/core/projects/portfolio";
import { renderWithProviders } from "@/test/harness";

import { ProjectSwitcher } from "./project-switcher";

function renderSwitcher(rows: Parameters<typeof ProjectSwitcher>[0]["rows"]) {
  return renderWithProviders(
    <ProjectSwitcher
      rows={rows}
      selectedId={null}
      onSelect={vi.fn()}
      query=""
      onQueryChange={vi.fn()}
      filter="all"
      onFilterChange={vi.fn()}
    />,
    { locale: "zh-CN" },
  );
}

describe("ProjectSwitcher appearance", () => {
  it("draws the icon and category a project was created with", () => {
    const entry = normalizePortfolioEntry({
      id: "P-trip",
      name: "秋季旅行",
      status: "running",
      icon: "plane",
      category: "travel",
      total_tasks: 4,
      done_tasks: 1,
    });
    renderSwitcher([toProjectRow(entry!)]);

    const row = screen.getByRole("button", { name: /秋季旅行/ });
    expect(row.querySelector('[data-project-icon="plane"]')).not.toBeNull();
    expect(row).toHaveTextContent("旅行 · 1/4 任务");
  });

  it("falls back to the folder and no category for older projects", () => {
    renderSwitcher([
      projectRowFromSummary({ id: "P-old", name: "旧项目", goal: "收尾" }),
    ]);

    const row = screen.getByRole("button", { name: /旧项目/ });
    expect(row.querySelector('[data-project-icon="folder"]')).not.toBeNull();
    expect(row).toHaveTextContent("收尾");
    expect(row).not.toHaveTextContent("·");
  });
});
