import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/harness";
import { ToolsIntegrationsSettingsPage } from "./tools-integrations-settings-page";

const mcpApi = vi.hoisted(() => ({
  approveMCPTrust: vi.fn(),
  forgetMCPOAuth: vi.fn(),
  listMCPTrust: vi.fn(),
  loadMCPConfig: vi.fn(),
  revokeMCPTrust: vi.fn(),
  updateMCPConfig: vi.fn(),
}));
vi.mock("@/core/mcp/api", () => mcpApi);

describe("tools and integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpApi.loadMCPConfig.mockResolvedValue({ mcp_servers: {} });
    mcpApi.listMCPTrust.mockResolvedValue({ entries: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens external tools first and loads channels only when selected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ToolsIntegrationsSettingsPage />, { locale: "zh-CN" });

    await waitFor(() => expect(mcpApi.loadMCPConfig).toHaveBeenCalledOnce());
    expect(screen.getByRole("tab", { name: "外部工具" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "消息渠道" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("tabpanel", { name: "消息渠道" })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "外部工具" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "外部工具" }));
    await waitFor(() => expect(mcpApi.loadMCPConfig).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("tabpanel", { name: "消息渠道" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("opens the channels destination directly without mounting external tools", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderWithProviders(
      <ToolsIntegrationsSettingsPage defaultTab="channels" />,
      { locale: "zh-CN" },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("tab", { name: "消息渠道" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mcpApi.loadMCPConfig).not.toHaveBeenCalled();

    rerender(<ToolsIntegrationsSettingsPage defaultTab="external" />);
    await waitFor(() => expect(mcpApi.loadMCPConfig).toHaveBeenCalledOnce());
    expect(screen.getByRole("tab", { name: "外部工具" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
