import { describe, expect, it } from "vitest";

import { zhCN } from "@/core/i18n/locales/zh-CN";

import { buildObservedReferenceTabs } from "./agent-workbench-pages";
import type { LiveToolEvent } from "./live-tool-timeline";
import { toWorkBlocks } from "./work-blocks";

function event(partial: Partial<LiveToolEvent>): LiveToolEvent {
  return {
    id: "event-1",
    name: "read_file",
    status: "done",
    startedAt: 1000,
    iteration: 0,
    ...partial,
  };
}

function referenceTitles(events: LiveToolEvent[]): string[] {
  return buildObservedReferenceTabs(toWorkBlocks(events), zhCN).flatMap((tab) =>
    tab.items.map((item) => item.title),
  );
}

describe("observed reference tabs", () => {
  it("keeps files the run wrote, edited or deleted out of its sources", () => {
    const titles = referenceTitles([
      event({ id: "read", input: { path: "src/context.ts" } }),
      event({
        id: "write",
        name: "dynamic__write_text_file",
        startedAt: 2000,
        input: { path: "hello.py", command: "dynamic__write_text_file" },
      }),
      event({
        id: "edit",
        name: "edit_file",
        startedAt: 3000,
        input: { path: "src/app.ts" },
      }),
      event({
        id: "patch",
        name: "apply_patch",
        startedAt: 4000,
        input: { changes: [{ path: "src/old.ts", op: "delete" }] },
      }),
    ]);

    expect(titles).toEqual(["context.ts"]);
  });

  it("never lists a tool name as a source when no target exists", () => {
    const titles = referenceTitles([
      event({
        id: "memory",
        name: "dynamic__recall_memory",
        input: {
          command: "dynamic__recall_memory",
          tool: "recall_memory",
        },
      }),
      event({
        id: "memory-query",
        name: "dynamic__recall_memory",
        startedAt: 2000,
        input: { query: "deploy notes", command: "dynamic__recall_memory" },
      }),
    ]);

    expect(titles).toEqual(["deploy notes"]);
    expect(titles.join(" ")).not.toMatch(/dynamic__|recall_memory/);
  });
});
