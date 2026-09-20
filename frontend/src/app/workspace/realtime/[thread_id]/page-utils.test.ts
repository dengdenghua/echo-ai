import { describe, expect, it } from "vitest";
import { resolveGroupPerspective } from "./page-utils";

describe("resolveGroupPerspective", () => {
  const groupIds = new Set(["agent-1", "agent-2", "agent-3"]);

  it("prioritizes current perspective if in group", () => {
    const res = resolveGroupPerspective("agent-2", "agent-3", "t1", groupIds, "agent-1");
    expect(res).toBe("agent-2");
  });

  it("falls back to activeAgentId if valid in group when current is null or invalid", () => {
    const res = resolveGroupPerspective(null, "agent-3", "t1", groupIds, "agent-1");
    expect(res).toBe("agent-3");

    const res2 = resolveGroupPerspective("invalid-agent", "agent-3", "t1", groupIds, "agent-1");
    expect(res2).toBe("agent-3");
  });

  it("falls back to fallbackAgentId if neither current nor activeAgentId is in group and nothing remembered", () => {
    const res = resolveGroupPerspective(null, "outsider", "t1", groupIds, "agent-1");
    expect(res).toBe("agent-1");
  });
});
