import { describe, expect, it } from "vitest";
import { serviceErrorMessage } from "./service-error";

describe("installation diagnostics", () => {
  it("preserves package diagnostics instead of treating provider access as user login", () => {
    const message = "插件发布服务拒绝下载，请检查 Echo 的发布服务配置。";
    expect(
      serviceErrorMessage(
        new Error(
          `HTTP 409 ${JSON.stringify({ detail: { code: "PACKAGE_ACCESS_DENIED", message, retryable: false } })}`,
        ),
      ),
    ).toBe(message);
  });
  it("unwraps legacy detail without trailing JSON punctuation", () => {
    expect(
      serviceErrorMessage(
        new Error('HTTP 502 {"detail":"插件包下载或安装失败，请稍后重试"}'),
      ),
    ).toBe("插件包下载或安装失败，请稍后重试");
  });
  it("keeps normal authentication handling", () => {
    expect(
      serviceErrorMessage(
        new Error('HTTP 401 {"detail":"missing authorization"}'),
      ),
    ).toContain("重新连接");
  });
});
