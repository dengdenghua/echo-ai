import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync } from "node:fs";
import { renderWithProviders } from "@/test/harness";
import { DEPARTMENT_SCENARIOS, DepartmentScenarios, resolveDepartment } from "./department-scenarios";
import type { Agent } from "@/core/agents/types";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), preset: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<object>(), useNavigate: () => mocks.navigate }));
vi.mock("@/core/agents/api", () => ({ listAgents: mocks.list }));
vi.mock("@/core/collaboration/task-collaborator-preset", () => ({ writeTaskCollaboratorPreset: mocks.preset, taskCollaboratorRouteForLeader: () => "/workspace/realtime/new" }));
vi.mock("@/core/teams/api", () => ({ createTeam: mocks.create, writePreferredTeam: vi.fn(), dispatchTeamUpdated: vi.fn() }));
describe("department templates", () => {
  it("renders general and department scenarios under one heading", async () => {
    mocks.list.mockResolvedValue([]);
    const view = renderWithProviders(<DepartmentScenarios additional={[{ id: "general-test", title: "通用协作", roles: [["general", "协调员"]], flow: "任务协调", output: "" }]} />);
    expect(screen.getAllByRole("heading", { name: "精选场景" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "事业部协作模板" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^启动部门场景/ })).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "启动部门场景：通用协作" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "展开全部 8 个场景" }));
    await userEvent.click(screen.getByRole("button", { name: "启动部门场景：通用协作" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "团队名称" })).toHaveValue("通用协作");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "收起场景" }));
    expect(screen.getAllByRole("button", { name: /^启动部门场景/ })).toHaveLength(6);
    view.unmount();
  });
  it("uses existing role directories and detects an incomplete team", () => {
    expect(DEPARTMENT_SCENARIOS).toHaveLength(7);
    for (const scenario of DEPARTMENT_SCENARIOS) {
      expect(new Set(scenario.roles.map(([id]) => id)).size).toBe(scenario.roles.length);
      // `twin_*` roles live in the Echo catalog extension; the built-in
      // personas stay under `agents/`. A scenario may mix both.
      for (const [id] of scenario.roles)
        expect(
          existsSync(`../agents/${id}`) ||
            existsSync(`../extensions/echo-agent-catalog/agents/${id}`),
        ).toBe(true);
      expect(resolveDepartment(scenario, []).missing).toHaveLength(scenario.roles.length);
    }
  });
  it("creates an editable team from the case without injecting a project prompt", async () => {
    const scenario = DEPARTMENT_SCENARIOS[0]!;
    mocks.list.mockResolvedValue(scenario.roles.map(([name]) => ({ name }) as Agent));
    mocks.create.mockResolvedValue({ id: "team-1", thread_id: "team-thread" });
    renderWithProviders(<DepartmentScenarios />);
    const button = screen.getByRole("button", { name: `启动部门场景：${scenario.title}` });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.clear(screen.getByRole("textbox", { name: "团队名称" }));
    await userEvent.type(screen.getByRole("textbox", { name: "团队名称" }), "My team");
    await userEvent.click(screen.getAllByRole("checkbox")[3]!);
    await userEvent.click(screen.getByRole("button", { name: "创建团队" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls.at(-1)![0].name).toBe("My team");
    expect(mocks.create.mock.calls.at(-1)![0].members).toHaveLength(3);
    expect(mocks.navigate).toHaveBeenLastCalledWith("/workspace/realtime/team-thread?welcome_team=team-1");
    expect(mocks.preset).toHaveBeenCalledWith(expect.objectContaining({ mode: "cluster" }));
  });
});
