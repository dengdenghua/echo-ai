import { describe, expect, it } from "vitest";
import { automationTargetFrom, toolResources } from "./references";
import {
  parseFileReference,
  resolveFileReference,
} from "@/core/navigation/file-reference";

describe("clickable conversation resources", () => {
  it("retains exact app identity through serialized tool results", () => {
    const target = {
      kind: "desktop_window",
      source: "computer",
      id: "win32:12:98",
      title: "Notes",
      icon_url: "data:image/png;base64,AA==",
    };
    expect(automationTargetFrom(JSON.stringify({ target }))).toEqual(target);
    expect(toolResources({ automation_target: target }, { target })).toEqual([
      { kind: "app", target },
    ]);
  });
  it("links only structured resources and suppresses secrets and unsafe URLs", () => {
    expect(
      toolResources({
        command: "rm note.txt",
        url: "javascript:alert(1)",
        file_path: "C:/repo/auth.json",
      }),
    ).toEqual([]);
    expect(toolResources({ url: "https://example.com/?token=secret" })).toEqual(
      [],
    );
    expect(
      toolResources({
        url: "https://example.com/report",
        file_path: "src/main.ts:12",
      }),
    ).toEqual([
      { kind: "web", url: "https://example.com/report", title: "example.com" },
      { kind: "file", path: "src/main.ts", lines: "12" },
    ]);
  });
  it("handles Windows, spaces, Unicode and line references", () => {
    expect(parseFileReference("D:\\项目\\My App\\main.py:12-16")).toEqual({
      path: "D:\\项目\\My App\\main.py",
      lines: "12-16",
    });
    expect(parseFileReference("src/app.ts#L5-L7")).toEqual({
      path: "src/app.ts",
      lines: "5-7",
    });
    expect(parseFileReference("file:///C:/repo/a.ts")).toEqual({
      path: "C:/repo/a.ts",
      lines: undefined,
    });
    expect(parseFileReference("https://example.com/a.ts")).toBeNull();
    expect(parseFileReference("python script.py")).toBeNull();
    expect(resolveFileReference("src/main.ts", "D:\\Project")).toBe(
      "D:\\Project/src/main.ts",
    );
  });
});
