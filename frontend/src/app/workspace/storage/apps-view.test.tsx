import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { AppsView } from "./apps-view";

vi.mock("@/core/apps/desktop-apps", () => ({ useDesktopApps: () => [] }));
vi.mock("@/core/storage/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/core/storage/api")>(),
  loadNASAssetURL: vi.fn().mockResolvedValue("blob:native-test"),
}));

it("renders a native image and falls back without a broken image on decode failure", async () => {
  const { container } = renderWithProviders(<AppsView
    apps={[{ app_id: "native", name: "Blender", path: "C:/Blender.lnk", category: "office", icon_available: true, bundle_id: null }]}
    query="" setQuery={() => {}} runSearch={() => {}} isSearching={false} manifest={null}
  />, { locale: "zh-CN" });
  await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:native-test'));
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByRole('button', { name: '打开 Blender' }).querySelector('svg')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Echo 应用' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '本机软件' })).toBeInTheDocument();
});
