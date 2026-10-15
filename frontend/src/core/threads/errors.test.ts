import { describe, expect, it } from "vitest";

import {
  getStreamErrorMessage,
  isNoModelConfigured,
  publicExecutionErrorMessage,
  threadDeleteErrorMessage,
} from "./errors";
import { EchoAPIError } from "../api/client";

it.each([
  ["THREAD_PROJECT_BOUND", "项目"],
  ["THREAD_TURN_ACTIVE", "停止任务"],
  ["THREAD_ASYNC_WORK_ACTIVE", "后台协作任务"],
  ["THREAD_ROOM_LINKED", "工作群"],
  ["THREAD_GROUP_LINKED", "工作群"],
])("explains delete conflict %s", (code, explanation) => {
  expect(
    threadDeleteErrorMessage(new EchoAPIError("raw request", 409, { code })),
  ).toContain(explanation);
});

it("does not expose raw server diagnostics in deletion errors", () => {
  const message = threadDeleteErrorMessage(
    new EchoAPIError("private stack", 500, "private stack"),
  );
  expect(message).toContain("对话已保留");
  expect(message).not.toContain("private stack");
});

it("renders nested historical tool-catalog failures without transport JSON", () => {
  const wrapped = JSON.stringify({
    codexErrorInfo: "other",
    message: JSON.stringify({
      error: { message: "Responses tool catalog is too large" },
    }),
  });
  expect(publicExecutionErrorMessage(wrapped)).toBe(
    "当前任务加载的工具过多，已超过执行接口上限。请减少启用的插件或工具后重试。",
  );
  expect(publicExecutionErrorMessage("Different failure")).toBe(
    "Different failure",
  );
});

it.each([
  "http_400: Error from provider (Console): Upstream request failed: Model is unavailable.",
  JSON.stringify({
    message: JSON.stringify({ error: { code: "model_not_found" } }),
  }),
])("explains unavailable models in saved and live failures", (error) => {
  const expected = "所选模型当前不可用，请在输入框选择其他模型后重试。";
  expect(publicExecutionErrorMessage(error)).toBe(expected);
  expect(getStreamErrorMessage(new Error(error), "network failure")).toBe(
    expected,
  );
});

it("says the Zen free tier is out of reach instead of promising it", () => {
  const expected =
    "OpenCode 的免费模型只对它自己的客户端开放，ECHO AI 无法使用。请添加一个模型，或连接 OpenCode Zen / Go。";
  for (const message of [
    "http_400: Error from provider (Console): OpenCode's free tier can only be used in OpenCode",
    "OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai",
    "OpenCode 免费额度只允许其官方客户端使用，请改用已连接的付费模型或自有模型。",
  ]) {
    expect(publicExecutionErrorMessage(message)).toBe(expected);
    // The card offers 添加模型 for these, like a desktop with no model.
    expect(isNoModelConfigured(message)).toBe(true);
  }
  expect(publicExecutionErrorMessage("Service temporarily unavailable")).toBe(
    "Service temporarily unavailable",
  );
  expect(isNoModelConfigured("Service temporarily unavailable")).toBe(false);
});

describe("getStreamErrorMessage", () => {
  it("maps missing stream endpoints to a product message", () => {
    expect(
      getStreamErrorMessage(new Error("Stream failed: 404"), "friendly"),
    ).toBe("friendly");
  });

  it("maps unavailable stream endpoints to a product message", () => {
    expect(
      getStreamErrorMessage({ message: "Stream failed: 503" }, "friendly"),
    ).toBe("friendly");
  });

  it("preserves specific non-endpoint errors", () => {
    expect(getStreamErrorMessage("Model timed out", "friendly")).toBe(
      "Model timed out",
    );
  });
});

it("tells a computer without any model how to get one", () => {
  const message = publicExecutionErrorMessage(
    "no LLM model configured — add one to data/custom_models.json (or set ANTHROPIC_API_KEY)",
  );
  expect(message).toBe("还没有可用的模型。添加一个模型后，重新发送即可。");
  expect(message).not.toContain("免费");
  expect(message).not.toContain("custom_models.json");
});
