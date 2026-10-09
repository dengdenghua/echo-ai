import { createRef, useState } from "react";
import { Globe } from "lucide-react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness";
import { BrowserStartPage } from "./browser-start-page";

vi.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { username: "local" } }),
}));
const onOpen = vi.fn();
const onSearch = vi.fn();
const onManageDesktop = vi.fn();
function Home() {
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState(0);
  return (
    <BrowserStartPage
      active
      query={query}
      onQueryChange={setQuery}
      onSearch={() => onSearch(query)}
      searchInputRef={createRef<HTMLInputElement>()}
      engines={[{ name: "百度" }, { name: "Bing" }]}
      selectedEngine={engine}
      onEngineChange={setEngine}
      onOpen={onOpen}
      onManageDesktop={onManageDesktop}
      apps={[
        {
          name: "项目管理",
          description: "项目协作",
          category: "work",
          url: "echo://workspace/projects",
          icon: Globe,
        },
        {
          name: "GitHub",
          description: "代码",
          category: "work",
          url: "https://github.com",
          icon: Globe,
        },
      ]}
    />
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it("submits the typed query by Enter and the search button", async () => {
  const user = userEvent.setup();
  renderWithProviders(<Home />, { locale: "zh-CN" });
  await user.type(
    screen.getByRole("textbox", { name: "搜索网页" }),
    "星空{Enter}",
  );
  expect(onSearch).toHaveBeenLastCalledWith("星空");
  await user.click(screen.getByRole("button", { name: "搜索", exact: true }));
  expect(onSearch).toHaveBeenCalledTimes(2);
});

it("filters and opens an existing app, and retains the desktop manager entry", async () => {
  const user = userEvent.setup();
  renderWithProviders(<Home />, { locale: "zh-CN" });
  await user.click(screen.getByRole("button", { name: "应用", exact: true }));
  await user.type(screen.getByRole("textbox", { name: "搜索应用" }), "项目");
  expect(
    screen.queryByRole("button", { name: "GitHub" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "项目管理" }));
  expect(onOpen).toHaveBeenCalledWith("echo://workspace/projects");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "应用", exact: true }));
  await user.click(screen.getByRole("button", { name: "管理应用与小组件" }));
  expect(onManageDesktop).toHaveBeenCalledOnce();
});

it("persists wallpaper and applies the selected search engine", async () => {
  const user = userEvent.setup();
  renderWithProviders(<Home />, { locale: "zh-CN" });
  await user.click(screen.getByRole("button", { name: "主页设置" }));
  await user.click(screen.getByRole("button", { name: "森林" }));
  expect(localStorage.getItem("echo.browser.start.wallpaper.v2")).toBe(
    "forest",
  );
  expect(screen.getByRole("button", { name: "森林" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "搜索引擎" }),
    "1",
  );
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "搜索", exact: true }),
  ).toHaveAttribute("title", "使用 Bing 搜索");
});

it("uploads, selects and restores a custom wallpaper", async () => {
  vi.stubGlobal("Image", class {
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  try {
    const user = userEvent.setup();
    const view = renderWithProviders(<Home />, { locale: "zh-CN" });
    await user.click(screen.getByRole("button", { name: "主页设置" }));
    await user.upload(screen.getByLabelText("上传自定义壁纸"), new File(["image"], "wallpaper.png", {type: "image/png"}));
    await waitFor(() => expect(screen.getByRole("button", {name: "自定义"})).toHaveAttribute("aria-pressed", "true"));
    const saved = localStorage.getItem("echo.browser.start.custom-wallpaper.v1");
    expect(saved).toMatch(/^data:image\/png;base64,/);
    expect(localStorage.getItem("echo.browser.start.wallpaper.v2")).toBe("custom");
    view.unmount();
    const restored = renderWithProviders(<Home />, { locale: "zh-CN" });
    expect(restored.container.querySelector(".browser-start-wallpaper")).toHaveAttribute("src", saved);
    await user.click(screen.getByRole("button", { name: "主页设置" }));
    await user.click(screen.getByRole("button", { name: "星海" }));
    expect(localStorage.getItem("echo.browser.start.wallpaper.v2")).toBe("ocean");
  } finally { vi.unstubAllGlobals(); }
});

it("rejects oversized uploads without changing the wallpaper", async () => {
  const user = userEvent.setup();
  renderWithProviders(<Home />, { locale: "zh-CN" });
  await user.click(screen.getByRole("button", { name: "主页设置" }));
  await user.upload(screen.getByLabelText("上传自定义壁纸"), new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {type: "image/png"}));
  expect(screen.getByRole("alert")).toHaveTextContent("图片不能超过 2 MB");
  expect(localStorage.getItem("echo.browser.start.custom-wallpaper.v1")).toBeNull();
});
