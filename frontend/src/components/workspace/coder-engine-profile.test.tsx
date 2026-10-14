import { describe, expect, it } from "vitest";

import type { CoderModelProfile } from "@/core/coder/api";

import { profileCanExecute, profileProblem } from "./coder-engine-profile";

const ready: CoderModelProfile = {
  source: "follow_system",
  selected_model: null,
  effective_model: "gpt-5.5",
  system_model: "gpt-5.5",
  reasoning_effort: null,
  model_source: "system",
  compatible: true,
  compatibility_reason: null,
  provider: "openai",
  proxy_required: true,
  execution_available: true,
};

describe("profileProblem", () => {
  it("says nothing while Codex can run", () => {
    expect(profileCanExecute(ready)).toBe(true);
    expect(profileProblem(ready, "zh-CN")).toBeNull();
  });

  it("points a computer without Codex at the engine store", () => {
    const missing = {
      ...ready,
      execution_available: false,
      execution_unavailable_reason: "not_installed",
    };
    expect(profileCanExecute(missing)).toBe(false);
    expect(profileProblem(missing, "zh-CN")).toContain("执行引擎里安装");
    expect(profileProblem(missing, "en-US")).toContain("Execution engines");
    expect(profileProblem(missing, "ja-JP")).toContain("実行エンジン");
    expect(profileProblem(missing, "ko-KR")).toContain("실행 엔진");
  });

  it("keeps the configured-path wording for a broken explicit executable", () => {
    const broken = {
      ...ready,
      execution_available: false,
      execution_unavailable_reason: "executable_unavailable",
    };
    expect(profileProblem(broken, "zh-CN")).toContain("未找到 Codex 程序");
  });
});
