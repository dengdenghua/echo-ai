import { describe, expect, it } from "vitest";

import type { CommandExecutionItem } from "@/core/realtime/items";

import {
  commandExecutionInput,
  parseJsonObjectText,
} from "./realtime-tool-compat";

function commandItem(
  overrides: Partial<CommandExecutionItem>,
): CommandExecutionItem {
  return {
    id: "call-1",
    type: "commandExecution",
    status: "completed",
    createdAt: "2026-10-15T00:00:00Z",
    command: "dynamic__write_text_file",
    cwd: null,
    aggregatedOutput: "",
    exitCode: null,
    processId: null,
    networkAccess: false,
    ...overrides,
  };
}

describe("realtime tool compat", () => {
  it("turns a JSON-object inputPreview string into real arguments", () => {
    const input = commandExecutionInput(
      commandItem({
        inputPreview: '{"path": "hello.py", "content": "print(\\"hi\\")"}',
      }),
    );

    expect(input).toMatchObject({
      path: "hello.py",
      content: 'print("hi")',
      command: "dynamic__write_text_file",
      tool: "dynamic__write_text_file",
    });
    expect(input).not.toHaveProperty("inputPreview");
  });

  it("keeps a preview string that is not one JSON object", () => {
    for (const preview of ['{"path": "hello.py", "content": "pri', "ls -la"]) {
      const input = commandExecutionInput(
        commandItem({ inputPreview: preview }),
      );
      expect(input.inputPreview).toBe(preview);
      expect(input).not.toHaveProperty("path");
    }
    expect(parseJsonObjectText('["a"]')).toBeNull();
    expect(parseJsonObjectText(42)).toBeNull();
  });

  it("lifts Codex dynamic tool arguments to the top level", () => {
    const input = commandExecutionInput(
      commandItem({
        command: "dynamic__run_command",
        inputPreview: {
          arguments: '{"command": "python hello.py", "cwd": "/work"}',
          server: null,
          tool: "run_command",
        },
      }),
    );

    expect(input).toMatchObject({
      command: "python hello.py",
      cwd: "/work",
      tool: "run_command",
      arguments: { command: "python hello.py", cwd: "/work" },
    });
  });
});
