import { describe, expect, it } from "vitest";

import { __testing } from "./terminal-panel";

describe("terminal shell label", () => {
  it("does not identify a macOS terminal as PowerShell", () => {
    expect(__testing.terminalShellLabel("MacIntel")).toBe("zsh");
  });

  it("keeps the Windows terminal label explicit", () => {
    expect(__testing.terminalShellLabel("Win32")).toBe("PowerShell");
  });

  it("uses a neutral label for other platforms", () => {
    expect(__testing.terminalShellLabel("Linux x86_64")).toBe("shell");
  });
});

describe("terminal socket URL", () => {
  it("carries only the cwd, never a credential", () => {
    const url = __testing.terminalSocketURL(
      "ws://127.0.0.1:8310",
      "s1",
      "/work dir",
    );
    expect(url).toBe("ws://127.0.0.1:8310/api/terminal/ws/s1?cwd=%2Fwork+dir");
    expect(url).not.toContain("token");
  });

  it("omits the query string without a cwd", () => {
    expect(__testing.terminalSocketURL("ws://127.0.0.1:8310", "s1")).toBe(
      "ws://127.0.0.1:8310/api/terminal/ws/s1",
    );
  });
});
