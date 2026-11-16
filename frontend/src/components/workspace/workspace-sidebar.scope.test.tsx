import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useNavigate } from "react-router-dom";
import { renderWithProviders } from "@/test/harness";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DesktopShellContext } from "./desktop-shell-context";
import { WorkspaceSidebar } from "./workspace-sidebar";

vi.mock("@/core/threads/hooks", async (original) => ({
  ...(await original<object>()),
  useThreads: () => ({ data: [] }),
}));
vi.mock("@/core/projects/hooks", async (original) => ({
  ...(await original<object>()),
  useProjects: () => ({ data: [] }),
  useThreadMap: () => ({ data: {} }),
}));
vi.mock("./sidebar-footer", () => ({ AgentFooter: () => null }));
vi.mock("./workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("./module-editor-dialog", () => ({ ModuleEditorDialog: () => null }));
vi.mock("./use-thread-run-status-by-href", () => ({ useThreadRunStatusByHref: () => ({}) }));

beforeEach(() => window.localStorage.clear());

const applications = [
  "/workspace/devices", "/workspace/mail", "/workspace/agents",
  "/workspace/storage?library=docs", "/workspace/knowledge",
  "/workspace/realtime/echo-assistant?agent=echo",
  "/workspace/realtime/echo-assistant-personal?agent=echo",
];

function Surface({ framed = true }: { framed?: boolean }) {
  const navigate = useNavigate();
  return <DesktopShellContext.Provider value={framed}>
    <button onClick={() => navigate("/workspace/devices")}>go app</button>
    <button onClick={() => navigate("/workspace/realtime/new")}>go home</button>
    <SidebarProvider><WorkspaceSidebar /></SidebarProvider>
  </DesktopShellContext.Provider>;
}

it.each(applications)("does not show conversation navigation on %s", (route) => {
  const { container } = renderWithProviders(<Surface />, { initialRoute: route, locale: "zh-CN" });
  expect(screen.queryByRole("button", { name: "新对话", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收起项目" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收起对话" })).not.toBeInTheDocument();
  expect(container.querySelector('[data-slot="sidebar"]')).toBeNull();
});

it("restores conversation navigation when returning home without changing its groups", () => {
  renderWithProviders(<Surface />, { initialRoute: "/workspace/realtime/new", locale: "zh-CN" });
  expect(screen.getByRole("button", { name: "新对话", exact: true })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "收起项目" }));
  fireEvent.click(screen.getByText("go app"));
  expect(screen.queryByRole("button", { name: "新对话", exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("go home"));
  expect(screen.getByRole("button", { name: "新对话", exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "展开项目" })).toBeVisible();
});

it("also hides chat groups in the standalone application navigation", () => {
  renderWithProviders(<Surface framed={false} />, { initialRoute: "/workspace/devices", locale: "zh-CN" });
  expect(screen.queryByRole("button", { name: "新对话", exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "收起对话" })).not.toBeInTheDocument();
});
