import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CapabilityInfo } from "@/core/agents/agent-world-api";
import { renderWithProviders } from "@/test/harness";

import { CapabilityMarketCard } from "./capability-market-card";

const connector: CapabilityInfo = {
  id: "westock-mcp",
  name: "westock-mcp",
  name_zh: "腾讯股票",
  description: "腾讯股票行情",
  description_zh: "腾讯股票行情",
  type: "mcp",
  auth_mode: "token",
  source: "connector",
  mcp_servers: [],
  skill_count: 3,
  installed: true,
  enabled: true,
  version: "1.0.0",
};

function renderCard(
  capability: CapabilityInfo,
  state: { connected?: boolean; statusError?: string | null } = {},
) {
  const action = vi.fn(() => Promise.resolve());
  renderWithProviders(
    <CapabilityMarketCard
      capability={capability}
      compact={false}
      featured={false}
      {...state}
      onInstall={action}
      onTry={action}
      onReviewPermissions={action}
      onConnect={action}
      onDisable={action}
      onDisconnect={action}
      onUninstall={action}
      onRefreshStatus={action}
    />,
  );
}

function expectNeutral(element: HTMLElement) {
  expect(element).toHaveClass("bg-muted", "text-muted-foreground");
  expect(element.className).not.toMatch(/warning/);
}

describe("CapabilityMarketCard status badge", () => {
  it("shows a disabled plugin as neutral, not amber", () => {
    renderCard({ ...connector, enabled: false }, { connected: false });
    expectNeutral(screen.getByText("已停用"));
  });

  it("shows an unread connection status as neutral, not amber", () => {
    renderCard(connector, { statusError: "HTTP 403" });
    expectNeutral(screen.getByText("状态未读取"));
  });

  it("shows a pending connection as neutral", () => {
    renderCard(connector, { connected: false });
    expectNeutral(screen.getByText("待连接"));
  });

  it("keeps amber for permission review and core for a live connection", () => {
    renderCard(
      { ...connector, id: "needs-review", permission_review_required: true },
      { connected: true },
    );
    // One badge, not the status badge plus a second copy of it.
    expect(screen.getByText("待确认权限")).toHaveClass("text-warning");

    renderCard({ ...connector, id: "linked" }, { connected: true });
    expect(screen.getByText("已连接")).toHaveClass("bg-core/15", "text-core");
  });

  it("flags a plugin not installed yet that will ask for permissions", () => {
    renderCard({
      ...connector,
      id: "preview",
      installed: false,
      permission_review_required: true,
    });
    expect(screen.getByText("待确认权限")).toHaveClass("text-warning");
  });
});
