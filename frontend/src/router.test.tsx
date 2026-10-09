import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { AllProviders } from "@/test/harness";

import { PageLoading, SettingsRoute } from "./router";

vi.mock("@/components/workspace/settings/settings-dialog", () => ({
  SettingsDialog: (props: {
    defaultSection: string;
    defaultToolsTab: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label="Settings">
      {props.defaultSection}:{props.defaultToolsTab}
      <button onClick={() => props.onOpenChange(false)}>Close settings</button>
    </div>
  ),
}));

function SettingsDestination() {
  const { pathname, search, state } = useLocation();
  return <output>{JSON.stringify({ pathname, search, state })}</output>;
}

describe("merged settings routes", () => {
  it("carries the channel selection to the regular workspace settings host", async () => {
    render(
      <AllProviders initialRoute="/workspace/settings?section=tools&toolsTab=channels&context=qa">
        <Routes>
          <Route path="/workspace/settings" element={<SettingsRoute />} />
          <Route
            path="/workspace/realtime/new"
            element={<SettingsDestination />}
          />
        </Routes>
      </AllProviders>,
    );
    const result = JSON.parse((await screen.findByRole("status")).textContent!);
    expect(result.search).toBe("?context=qa");
    expect(result.state).toEqual({
      settingsSection: "tools",
      settingsToolsTab: "channels",
    });
  });

  it("opens embedded channel settings without depending on a sidebar host", async () => {
    render(
      <AllProviders initialRoute="/workspace/settings?section=tools&toolsTab=channels&embedded=app&context=qa">
        <Routes>
          <Route path="/workspace/settings" element={<SettingsRoute />} />
          <Route
            path="/workspace/realtime/new"
            element={<SettingsDestination />}
          />
        </Routes>
      </AllProviders>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveTextContent("tools:channels");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    const result = JSON.parse((await screen.findByRole("status")).textContent!);
    expect(result.search).toBe("?embedded=app&context=qa");
  });
});

describe("PageLoading", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers recovery when a lazy page takes too long", () => {
    vi.useFakeTimers();
    render(
      <AllProviders locale="zh-CN">
        <PageLoading />
      </AllProviders>,
    );

    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();

    act(() => vi.advanceTimersByTime(8_000));

    expect(screen.getByText("正在加载工作区...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
