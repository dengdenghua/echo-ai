import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { ModelSharingSettings } from "./model-sharing-settings";

vi.mock("@/components/workspace/codex-hotspot-panel", () => ({
  CodexHotspotPanel: () => <button>分享我的模型</button>,
}));
afterEach(() => vi.unstubAllGlobals());

it("keeps connection drafts while switching sharing modes without submitting", () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ connections: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  renderWithProviders(<ModelSharingSettings onConnected={vi.fn()} />);
  expect(screen.getByLabelText("模型地址")).not.toBeVisible();
  fireEvent.click(screen.getByText("连接共享模型"));
  fireEvent.change(screen.getByLabelText("模型地址"), {
    target: { value: "https://example.com/v1" },
  });
  expect(screen.getByRole("button", { name: "验证并读取模型" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /团队模型.*使用/ }));
  expect(screen.getByLabelText("模型地址")).not.toBeVisible();
  fireEvent.click(screen.getByText("加入团队"));
  expect(screen.getByLabelText("团队网关地址")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: /个人共享.*连接/ }));
  expect(screen.getByLabelText("模型地址")).toHaveValue(
    "https://example.com/v1",
  );
  expect(fetchMock.mock.calls).toHaveLength(1);
});
