import { expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/harness";
import {
  deliveryEvidence,
  isDocumentationPath,
  createVirtualDiff,
  TaskDeliveryReview,
} from "./task-delivery-review";
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

it("identifies documentation file paths correctly", () => {
  expect(isDocumentationPath("report.md")).toBe(true);
  expect(isDocumentationPath("notes.txt")).toBe(true);
  expect(isDocumentationPath("docs/README.markdown")).toBe(true);
  expect(isDocumentationPath("PATH/TO/DOC.MD")).toBe(true);
  expect(isDocumentationPath("src/agent.py")).toBe(false);
  expect(isDocumentationPath("src/index.ts")).toBe(false);
});

it("creates virtual full diff from content for new files", () => {
  const diff = createVirtualDiff("# Title\nSecond line");
  expect(diff).toBe("@@ -0,0 +1,2 @@\n+# Title\n+Second line");
  expect(createVirtualDiff("")).toBe("");
});

it("generates virtual diff on create_file events with content", () => {
  const result = deliveryEvidence([
    event({
      name: "create_file",
      input: { path: "docs/report.md", content: "# Title\nLine 2" },
    }),
  ]);
  expect(result.changes[0]).toMatchObject({
    path: "docs/report.md",
    op: "create",
    diff: "@@ -0,0 +1,2 @@\n+# Title\n+Line 2",
  });
});

it("generates virtual diff on file_change event with op create and content", () => {
  const result = deliveryEvidence([
    event({
      name: "file_change",
      input: {
        changes: [
          { path: "notes.txt", op: "create", content: "item 1\nitem 2" },
        ],
      },
    }),
  ]);
  expect(result.changes[0]).toMatchObject({
    path: "notes.txt",
    op: "create",
    diff: "@@ -0,0 +1,2 @@\n+item 1\n+item 2",
  });
});

it("extracts diff_preview when available in tool output", () => {
  const result = deliveryEvidence([
    event({
      name: "write_text_file",
      input: { path: "out.md" },
      output: { diff_preview: "@@ -0,0 +1,1 @@\n+sample" },
    }),
  ]);
  expect(result.changes[0]?.diff).toBe("@@ -0,0 +1,1 @@\n+sample");
});

it("renders gray lightweight notice for pure doc delivery without verification checks", () => {
  const events = [
    event({
      name: "create_file",
      input: { path: "POD-App深度审计报告.md", content: "# Audit report" },
    }),
  ];
  renderWithProviders(<TaskDeliveryReview events={events} running={false} />);
  expect(screen.getByText("文档/分析类交付，无测试项")).toBeDefined();
  expect(
    screen.queryByText("本轮未收到结构化验证记录，不能据此确认测试通过。"),
  ).toBeNull();
});

it("renders warning notice when delivery includes non-doc code files without verification checks", () => {
  const events = [
    event({
      name: "create_file",
      input: { path: "src/agent.py", content: "def main(): pass" },
    }),
  ];
  renderWithProviders(<TaskDeliveryReview events={events} running={false} />);
  expect(
    screen.getByText("本轮未收到结构化验证记录，不能据此确认测试通过。"),
  ).toBeDefined();
  expect(screen.queryByText("文档/分析类交付，无测试项")).toBeNull();
});
