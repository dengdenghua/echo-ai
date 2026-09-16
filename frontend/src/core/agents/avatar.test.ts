import { expect, it } from "vitest";
import { withAgentAvatarVersion } from "./avatar";

it("maps historical avatar paths while preserving origin and cache parameters", () => {
  expect(withAgentAvatarVersion("http://localhost:8310/api/agents/coder/avatar?v=123")).toBe("http://localhost:8310/api/agents/kane/avatar?v=123");
  expect(withAgentAvatarVersion("/api/agents/aoi/avatar")).toBe("/api/agents/zero/avatar");
  expect(withAgentAvatarVersion("/api/agents/custom/avatar")).toBe("/api/agents/custom/avatar");
});
