import { describe, expect, it } from "vitest";

import { loginErrorMessage, SERVICE_UNREACHABLE_MESSAGE } from "./login-utils";

describe("loginErrorMessage", () => {
  const describeError = (error: unknown) =>
    error instanceof Error ? error.message : "登录失败";

  it("replaces the browser's raw network failure with a readable hint", () => {
    expect(loginErrorMessage(new TypeError("Failed to fetch"), describeError)).toBe(
      SERVICE_UNREACHABLE_MESSAGE,
    );
  });

  it("keeps server-provided messages", () => {
    expect(loginErrorMessage(new Error("用户名格式不正确"), describeError)).toBe(
      "用户名格式不正确",
    );
  });
});
