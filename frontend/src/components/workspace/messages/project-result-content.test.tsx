import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseProjectReceipt, ProjectResultContent } from "./project-result-content";
const files = vi.hoisted(() => ({ artifacts: [] as string[] }));
vi.mock("../artifacts/context", () => ({ useOptionalArtifacts: () => files }));

const receipt = "Project OS 已继续推进项目。\n\n项目：发布验收（P-123）\n状态：done · ticks 3\n成员：eve, zero\n\n里程碑进展：\n- deliver：done · 2/2 任务完成\nPM 驾驶舱：\n- deliver：2/2 · 100%";
describe("project result receipt", () => {
  beforeEach(() => { files.artifacts = []; });
  it("previews real final files without treating drafts as deliverables", () => {
    files.artifacts = ["workspace-output:final:release.md", "workspace-output:stages:draft.md"];
    const listener = vi.fn();
    window.addEventListener("echo:open-artifact", listener);
    const { unmount } = render(<ProjectResultContent content={receipt} renderBody={text => <p>{text}</p>} />);
    expect(screen.queryByText("draft.md")).toBeNull();
    expect(screen.queryByRole("button", { name: "查看成果" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /release\.md/ }));
    expect(listener.mock.calls[0]?.[0].detail.path).toBe("workspace-output:final:release.md");
    window.removeEventListener("echo:open-artifact", listener);
    unmount();
    files.artifacts = [];
  });
  it("deduplicates counts and opens existing workbench surfaces", () => {
    const listener = vi.fn();
    window.addEventListener("echo:agent-workbench-open", listener);
    const { container } = render(<ProjectResultContent content={receipt} renderBody={text => <p>{text}</p>} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText(/2\/2 项任务完成/)).toBeInTheDocument();
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "查看成果" }));
    expect(listener.mock.calls[0]?.[0].detail.tab).toBe("artifacts");
    expect(screen.getByRole("link", { name: "查看项目" })).toHaveAttribute("href", "#/workspace/projects?project=P-123");
    window.removeEventListener("echo:agent-workbench-open", listener);
  });
  it("does not turn blocked projects into completed receipts", () => {
    render(<ProjectResultContent content={receipt.replace("状态：done", "状态：blocked")} renderBody={text => <p>{text}</p>} />);
    expect(screen.getByText("需要处理")).toBeInTheDocument();
    expect(screen.queryByText("已完成")).toBeNull();
  });
  it("keeps ordinary prose, incomplete receipts and streams unchanged", () => {
    expect(parseProjectReceipt("解释：" + receipt)).toBeNull();
    expect(parseProjectReceipt("Project OS 已继续推进项目。")).toBeNull();
    render(<ProjectResultContent content={receipt} isLoading renderBody={text => <p>{text}</p>} />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
