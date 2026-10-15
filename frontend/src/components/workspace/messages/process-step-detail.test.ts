import { describe, expect, it } from "vitest";

import { stepDetailText } from "./process-step-detail";

describe("stepDetailText", () => {
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
