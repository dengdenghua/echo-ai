import { expect, it } from "vitest";
import { deliveryEvidence } from "./task-delivery-review";
import type { LiveToolEvent } from "./live-tool-timeline";
const event = (extra: Partial<LiveToolEvent>): LiveToolEvent => ({
  id: "v1",
  name: "verification:test",
  status: "done",
  startedAt: 0,
  iteration: 0,
  ...extra,
});
it("requires completed structured exit code zero to claim a pass", () => {
  const result = deliveryEvidence([
    event({ output: { exitCode: 0 } }),
    event({ id: "v2", output: { summary: "all tests passed" } }),
    event({ id: "v3", output: { exitCode: 1, summary: "passed" } }),
    event({ id: "v4", status: "running", output: { exitCode: 0 } }),
    event({ id: "v5", status: "interrupted", output: { exitCode: 0 } }),
  ]);
  expect(result.checks.map((c) => c.state)).toEqual([
    "passed",
    "unknown",
    "failed",
    "unknown",
    "unknown",
  ]);
});
it("never treats a file read or model text as a change or verification", () => {
  expect(
    deliveryEvidence([
      event({
        name: "read_file",
        input: { path: "a.ts" },
        output: "Tests passed. Modified a.ts.",
      }),
    ]),
  ).toEqual({ checks: [], changes: [] });
});
it("includes native and OpenCode write tools without inventing a diff", () => {
  const result = deliveryEvidence([
    event({
      name: "mcp:write_file",
      input: { arguments: { path: "src/a.ts" } },
    }),
  ]);
  expect(result.changes[0]).toMatchObject({ path: "src/a.ts", op: "update" });
  expect(result.changes[0]?.diff).toBeUndefined();
});
it("retains failed file operation status and truncated diff provenance", () => {
  const { changes } = deliveryEvidence([
    event({
      name: "file_change",
      status: "error",
      input: {
        changes: [
          { path: "a.ts", op: "update", diff: "+a", diffTruncated: true },
        ],
      },
    }),
  ]);
  expect(changes[0]).toMatchObject({
    path: "a.ts",
    status: "error",
    truncated: true,
    diff: "+a",
  });
});
