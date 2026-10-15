import { describe, expect, test } from "vitest";

import { structuredFailureFromMessages } from "@/components/workspace/messages/message-list";
import type { Message } from "@/core/api/types";

import {
  engineSelectionFailureMessage,
  executionEngineCopy,
} from "./execution-engine";

// A first-time user who picks Codex before connecting it got the backend's
// English diagnostics ("Codex is unavailable (model_incompatible). Configure
// the Codex engine or select Echo.") in a Chinese UI, naming an engine that
// is not in the menu.
const codexBlocked: Message = {
  type: "ai",
  id: "turn-1",
  content: "",
  additional_kwargs: {
    error: {
      message:
        "Codex is unavailable (model_incompatible). Configure the Codex engine or select Echo.",
      info: {
        code: "execution_unavailable",
        engine: "codex",
        reason: "model_incompatible",
        disposition: "blocked_on_user",
      },
    },
  },
};

describe("engine selection failures", () => {
  test("keep the engine and reason from the turn error", () => {
    expect(structuredFailureFromMessages([codexBlocked])).toMatchObject({
      code: "execution_unavailable",
      engine: "codex",
      reason: "model_incompatible",
    });
  });

  test("tell a Codex user what to do, in their language", () => {
    const failure = structuredFailureFromMessages([codexBlocked])!;
    const zh = engineSelectionFailureMessage(
      executionEngineCopy("zh-CN"),
      failure.engine,
      failure.reason,
      failure.detail,
    );
    expect(zh).toContain("登录 ChatGPT");
    // The way out is a model the user added, never OpenCode's free tier,
    // which serves only OpenCode's own app.
    expect(zh).toContain("换成自动");
    expect(zh).not.toContain("免费");
    expect(zh).not.toMatch(/unavailable|select Echo/);
    for (const locale of ["en-US", "ja-JP", "ko-KR"]) {
      const text = engineSelectionFailureMessage(
        executionEngineCopy(locale),
        "codex",
        "model_incompatible",
        failure.detail,
      );
      expect(text).not.toContain("select Echo");
      expect(text).toContain("ChatGPT");
    }
  });

  test("unknown Codex reasons still get a readable sentence", () => {
    expect(
      engineSelectionFailureMessage(
        executionEngineCopy("zh-CN"),
        "codex",
        "something_new",
        "Codex is unavailable (something_new).",
      ),
    ).toBe(
      "Codex 暂时无法运行这条消息。也可以把执行引擎换成自动，用你添加的模型继续。",
    );
  });

  test("OpenCode keeps its Chinese readiness reason", () => {
    const copy = executionEngineCopy("zh-CN");
    expect(
      engineSelectionFailureMessage(
        copy,
        "opencode",
        "unavailable",
        "请安装 OpenCode 并配置 ECHO_OPENCODE_BIN。",
      ),
    ).toBe("请安装 OpenCode 并配置 ECHO_OPENCODE_BIN。");
    expect(
      engineSelectionFailureMessage(copy, "opencode", "unavailable", "boom"),
    ).toBe(copy.turnBlocked.opencode);
  });
});
