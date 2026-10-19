import { describe, expect, it } from "vitest";

import { readableToolOutput, stepDetailText } from "./process-step-detail";

describe("stepDetailText", () => {
  it("unwraps historical CodeBuddy Python-repr MCP envelopes without evaluation", () => {
    const inner = JSON.stringify([
      {
        type: "text",
        text: JSON.stringify({
          stdout: "",
          stderr: "系统找不到文件 OpticStudio.exe。\n",
          sandbox_backend: "direct",
        }),
      },
    ]);
    const legacy =
      "[{'type': 'text', 'text': '" +
      inner.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
      "'}]";
    expect(readableToolOutput(legacy)).toBe("系统找不到文件 OpticStudio.exe。");
  });
  it("decodes JSON strings before displaying streamed code", () => {
    const code = "def validate():\n    return 'ready'\n";
    expect(readableToolOutput(JSON.stringify(JSON.stringify(code)))).toBe(
      code.trim(),
    );
    expect(
      readableToolOutput(
        '{"path":"check.py","content":"def validate():\\n    return',
      ),
    ).toBe("def validate():\n    return");
  });

  it("keeps literal log escapes and Windows paths intact", () => {
    expect(readableToolOutput(String.raw`C:\new\tools\test.py`)).toBe(
      String.raw`C:\new\tools\test.py`,
    );
    expect(readableToolOutput(String.raw`pattern: \n\t`)).toBe(
      String.raw`pattern: \n\t`,
    );
  });

  it("buffers incomplete JSON escapes without flashing transport syntax", () => {
    expect(readableToolOutput('{"content":"line\\nnext' + "\\")).toBe(
      "line\nnext",
    );
    expect(readableToolOutput('{"content":"line\\u4e')).toBe("line");
  });
  it("unwraps Codex's text items around the Echo tool result", () => {
    const result = JSON.stringify([
      {
        text: JSON.stringify({
          argv: ["python", "hello.py"],
          exit_code: 0,
          stdout: "Hello Echo\n2026-10-15T13:04:41+09:00\n",
          stderr: "",
          sandbox_backend: "direct",
        }),
      },
    ]);
    expect(
      stepDetailText({ args: { command: "python hello.py", output: result } }),
    ).toBe("$ python hello.py\n\nHello Echo\n2026-10-15T13:04:41+09:00");
  });

  it("shows an error the tool reported", () => {
    expect(
      stepDetailText({
        args: { command: "python hello.py" },
        result: { error: "path_escapes_sandbox: E:\\ws not under E:\\ws\\out" },
      }),
    ).toBe(
      "$ python hello.py\n\npath_escapes_sandbox: E:\\ws not under E:\\ws\\out",
    );
  });

  it("returns null when a step has neither command nor output", () => {
    expect(stepDetailText({ args: {} })).toBeNull();
  });
});
