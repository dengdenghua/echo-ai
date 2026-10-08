import { describe, expect, it } from "vitest";
import type { CoordinationTask } from "@/core/cowork/coordination";
import { mergeCoordinatedAgents } from "./coordinated-agents";
import { memberErrorText } from "./member-error";

const task: CoordinationTask = { id: "job", member_id: "kane", actor_id: "user", title: "技术分析", status: "working", result: "", dependencies: [], waiting_for: [], background: true, created_at: 10 };
describe("durable member workbench", () => {
  it("explains a timeout without exposing floating point diagnostics or claiming success", () => {
    expect(memberErrorText("RuntimeError: subagent timed out after 899.9850000000151s"))
      .toBe("执行超过 15 分钟，已停止本次任务。尚未收到可交付结果，其他成员可继续工作。");
    expect(memberErrorText("权限已撤回")).toBe("权限已撤回");
  });
  it("shows queue progress and later real delivery without a live tool event", () => {
    const running = mergeCoordinatedAgents([], [task]);
    expect(running[0]?.status).toBe("running");
    const delivered = mergeCoordinatedAgents(running, [{ ...task, status: "done", result: "技术模块结果" }]);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.resultSummary).toBe("技术模块结果");
    expect(delivered[0]?.status).toBe("done");
  });
  it("prefers the latest assignment and excludes foreground leader entries", () => {
    const tiles = mergeCoordinatedAgents([], [task, { ...task, id: "new", created_at: 20, status: "pending" }, { ...task, member_id: "eve", background: false }]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.status).toBe("pending");
    expect(tiles[0]?.resultSummary).toBeUndefined();
  });
});
