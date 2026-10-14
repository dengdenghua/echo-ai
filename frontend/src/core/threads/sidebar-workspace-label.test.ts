import { describe, expect, it } from "vitest";
import { isGeneratedWorkspaceProject } from "./sidebar";

describe("generated workspace labels", () => {
  const id = "tc47NxUvyacRCezf0wZ132";

  it("recognizes nested task storage on Windows and Unix", () => {
    expect(isGeneratedWorkspaceProject(id, `D:\\echo-ai\\data\\workspaces\\tenant-1\\${id}`)).toBe(true);
    expect(isGeneratedWorkspaceProject(id, `/echo/data/workspaces/${id}/`)).toBe(true);
  });

  it("preserves explicit project names and ordinary folders", () => {
    expect(isGeneratedWorkspaceProject("市场研究", `/echo/data/workspaces/${id}`)).toBe(false);
    expect(isGeneratedWorkspaceProject(id, `/projects/${id}`)).toBe(false);
    expect(isGeneratedWorkspaceProject("echo-ai", "D:/projects/echo-ai")).toBe(false);
    expect(isGeneratedWorkspaceProject("项目", undefined)).toBe(false);
  });
});
