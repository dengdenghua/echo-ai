import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { untypedApi } from "@/core/api/request";
import { hubChangeLifecycle } from "@/core/plugins/api";
import { startNASService } from "@/core/storage/api";
import { KnowledgePluginCard } from "./knowledge-plugin-card";

vi.mock("@/core/api/request", () => ({
  untypedApi: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/core/plugins/api", () => ({ hubChangeLifecycle: vi.fn() }));
vi.mock("@/core/storage/api", () => ({ startNASService: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

it("requires an explicit install and reports failures without changing state", async () => {
  vi.mocked(untypedApi.get).mockResolvedValue({
    up: false,
    installed: false,
    enabled: false,
  });
  vi.mocked(hubChangeLifecycle).mockRejectedValueOnce(new Error("组件缺失"));
  const onChange = vi.fn();
  renderWithProviders(<KnowledgePluginCard onChange={onChange} />);
  const install = await screen.findByRole("button", { name: "安装并启用" });
  expect(hubChangeLifecycle).not.toHaveBeenCalled();
  expect(startNASService).not.toHaveBeenCalled();
  fireEvent.click(install);
  expect(await screen.findByRole("alert")).toHaveTextContent("组件缺失");
  expect(onChange).not.toHaveBeenCalled();
  expect(install).toBeEnabled();
});

it("offers uninstall with retained data and refreshes the page after success", async () => {
  vi.mocked(untypedApi.get).mockResolvedValue({
    up: true,
    installed: true,
    enabled: true,
    version: "0.2.0",
  });
  vi.mocked(hubChangeLifecycle).mockResolvedValue(undefined);
  const onChange = vi.fn().mockResolvedValue(true);
  renderWithProviders(<KnowledgePluginCard onChange={onChange} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "卸载并保留数据" }),
  );
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(hubChangeLifecycle).toHaveBeenCalledWith(
    "knowledge_storage",
    "uninstall",
  );
});

it("recovers a stopped process without reinstalling", async () => {
  vi.mocked(untypedApi.get).mockResolvedValue({
    up: false,
    installed: true,
    enabled: true,
  });
  const onChange = vi.fn().mockResolvedValue(true);
  renderWithProviders(<KnowledgePluginCard onChange={onChange} />);
  fireEvent.click(await screen.findByRole("button", { name: "启动服务" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(startNASService).toHaveBeenCalledOnce();
  expect(hubChangeLifecycle).not.toHaveBeenCalled();
});
