import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflexFetch } from "@/app/workspace/reflex/api";
import { getDualHelixShadowStatus } from "@/core/evolution/api";
import { renderWithProviders } from "@/test/harness";

import { EvolutionGovernancePanel } from "./evolution-governance-panel";

vi.mock("@/core/evolution/api", () => ({
  getDualHelixShadowStatus: vi.fn(async () => ({
    ok: true,
    enabled: false,
    isolation: "bounded_snapshot_read_only",
    runs: [],
  })),
  setDualHelixShadowEnabled: vi.fn(async (enabled: boolean) => ({
    ok: true,
    enabled,
    isolation: "bounded_snapshot_read_only",
    runs: [],
  })),
}));

vi.mock("@/app/workspace/reflex/api", () => ({ reflexFetch: vi.fn() }));
vi.mock("@/app/workspace/reflex/gepa-panel", () => ({
  GepaPanel: () => null,
}));
vi.mock("@/app/workspace/reflex/variant-performance-panel", () => ({
  VariantPerformancePanel: () => null,
}));
vi.mock("@/components/workspace/gene-lock-badge", () => ({
  GeneLockBadge: () => null,
}));
vi.mock("./evolution-control-panel", () => ({
  EvolutionControlPanel: () => <div>policy-panel</div>,
}));
vi.mock("./settings/evolution-settings-page", () => ({
  default: () => <div>runtime-settings</div>,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="current-route">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe("EvolutionGovernancePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reflexFetch).mockImplementation(async (path) => {
      if (path === "/api/reflex/stats") {
        return {
          try_count: 2,
          hit_count: 1,
          hit_rate: 0.5,
          by_rule: {},
        };
      }
      if (path === "/api/reflex/rules") {
        return {
          rules: [{ rule_id: "governance-rule", kind: "intent", priority: 10 }],
        };
      }
      if (path.startsWith("/api/reflex/timeseries")) {
        return { buckets: [], totals_by_rule: {}, total_events: 0 };
      }
      if (path === "/api/reflex/tiers") return { tiers: [] };
      throw new Error(`Unexpected reflex endpoint: ${path}`);
    });
  });

  it("distinguishes an unavailable protection status from the disabled state", async () => {
    const user = userEvent.setup();
    vi.mocked(getDualHelixShadowStatus).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    renderWithProviders(<EvolutionGovernancePanel />, { locale: "zh-CN" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保护状态暂时无法加载；现有设置没有改变。",
    );
    expect(screen.getByRole("button", { name: "状态不可用" })).toBeDisabled();
    expect(screen.queryByText(/当前关闭/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByText(/当前关闭，不会触发另一引擎/),
    ).toBeInTheDocument();
  });

  it("opens the real rule monitor from its direct URL and preserves unrelated query parameters on tab changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <EvolutionGovernancePanel />
        <LocationProbe />
      </>,
      {
        locale: "zh-CN",
        initialRoute:
          "/workspace/evolution?section=governance&detail=reflex&project=project-1",
      },
    );

    expect(await screen.findByText("governance-rule")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "规则与响应" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.queryByText("policy-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("runtime-settings")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /编辑/ })).toHaveAttribute(
      "href",
      "/workspace/reflex/edit",
    );

    await user.click(screen.getByRole("tab", { name: "策略与预算" }));
    expect(await screen.findByText("policy-panel")).toBeInTheDocument();
    expect(screen.queryByText("governance-rule")).not.toBeInTheDocument();
    expect(screen.getByLabelText("current-route")).toHaveTextContent(
      "/workspace/evolution?section=governance&detail=control&project=project-1",
    );

    await user.click(screen.getByRole("tab", { name: "运行与设置" }));
    expect(await screen.findByText("runtime-settings")).toBeInTheDocument();
    expect(screen.queryByText("policy-panel")).not.toBeInTheDocument();
    expect(screen.getByLabelText("current-route")).toHaveTextContent(
      "/workspace/evolution?section=governance&detail=runtime&project=project-1",
    );

    await user.click(screen.getByRole("tab", { name: "治理摘要" }));
    expect(screen.queryByText("runtime-settings")).not.toBeInTheDocument();
    expect(screen.getByLabelText("current-route")).toHaveTextContent(
      "/workspace/evolution?section=governance&project=project-1",
    );
  });

  it.each(["", "&detail=invalid"])(
    "defaults to the summary without mounting inactive rule controls (%s)",
    async (detailQuery) => {
      const user = userEvent.setup();
      renderWithProviders(
        <>
          <EvolutionGovernancePanel />
          <LocationProbe />
        </>,
        {
          locale: "zh-CN",
          initialRoute: `/workspace/evolution?section=governance${detailQuery}`,
        },
      );

      expect(screen.getByRole("tab", { name: "治理摘要" })).toHaveAttribute(
        "data-state",
        "active",
      );
      expect(reflexFetch).not.toHaveBeenCalled();
      expect(screen.queryByText("policy-panel")).not.toBeInTheDocument();
      expect(screen.queryByText("runtime-settings")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /规则与响应/ }));
      expect(await screen.findByText("governance-rule")).toBeInTheDocument();
      expect(screen.getByLabelText("current-route")).toHaveTextContent(
        "/workspace/evolution?section=governance&detail=reflex",
      );
    },
  );
});
