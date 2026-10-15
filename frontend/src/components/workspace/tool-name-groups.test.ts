import { describe, expect, it } from "vitest";

import {
  canonicalToolName,
  isFileMutationToolName,
  isReadToolName,
  isShellToolName,
  shellCommandFromInput,
  stripToolNamespace,
} from "./tool-name-groups";

describe("tool name groups", () => {
  it("strips engine and host-tool namespaces", () => {
    expect(canonicalToolName("dynamic__write_text_file")).toBe(
      "write_text_file",
    );
    expect(canonicalToolName("echo__list_cwd")).toBe("list_cwd");
    expect(canonicalToolName("echo.read_file")).toBe("read_file");
    expect(canonicalToolName("codex.dynamic__run_command")).toBe("run_command");
    expect(canonicalToolName(" OpenCode.Bash ")).toBe("bash");
    // Other namespaces describe a different tool, not a host wrapper.
    expect(canonicalToolName("mcp__github__list_issues")).toBe(
      "mcp__github__list_issues",
    );
    expect(stripToolNamespace("dynamic__callAgent")).toBe("callAgent");
  });

  it("puts namespaced tools in their bare tool's family", () => {
    expect(isShellToolName("dynamic__run_command")).toBe(true);
    expect(isShellToolName("dynamic__exec_shell")).toBe(true);
    expect(isReadToolName("dynamic__read_file")).toBe(true);
    expect(isReadToolName("dynamic__list_cwd")).toBe(true);
    expect(isFileMutationToolName("dynamic__write_text_file")).toBe(true);
    expect(isFileMutationToolName("echo__edit_text_file")).toBe(true);
    expect(isFileMutationToolName("dynamic__read_file")).toBe(false);
  });

  it("never treats a serialized argument object as a command line", () => {
    expect(
      shellCommandFromInput({ inputPreview: '{"command": "ls"}' }),
    ).toBeUndefined();
    expect(shellCommandFromInput({ inputPreview: "npm test" })).toBe(
      "npm test",
    );
    expect(
      shellCommandFromInput(
        { command: "dynamic__run_command" },
        "dynamic__run_command",
      ),
    ).toBeUndefined();
  });
});
