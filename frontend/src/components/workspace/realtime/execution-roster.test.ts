import { describe, expect, it } from "vitest";
import { executionRoster } from "./execution-roster";
import type { LiveToolEvent } from "../live-tool-timeline";

const leader = { agent_id: "eve", name: "eve", display_name: "Eve", role: "tl" as const };
const event = (agentId: string, lifecycle: "spawned" | "finished" = "spawned") =>
  ({ agentId, lifecycle, startedAt: 1, iteration: 0 } as LiveToolEvent);

describe("execution roster", () => {
  it("shows spawned members before their first tool output and preserves the saved roster", () => {
    const saved = [leader];
    const result = executionRoster(saved, [event("aoi")], []);
    expect(result.members.map(m => m.display_name)).toEqual(["Eve", "Zero"]);
    expect(result.members[1]?.avatar_url).toBe("/api/agents/zero/avatar");
    expect(result.focusIds.get("zero")).toBe("aoi");
    expect(saved).toEqual([leader]);
  });
  it("deduplicates legacy/current identities and retains completed workers for inspection", () => {
    const result = executionRoster([leader], [event("aoi"), event("zero", "finished")], []);
    expect(result.members).toHaveLength(2);
  });
  it("does not count ordinary main-agent tools as summoned members", () => {
    expect(executionRoster([leader], [{ agentId: "eve" } as LiveToolEvent], []).members).toEqual([leader]);
  });
});
