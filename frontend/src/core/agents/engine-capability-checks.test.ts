import { describe, expect, it } from "vitest";
import { engineVerificationLabel } from "./engine-capability-checks";

describe("engine verification labels", () => {
  it("does not confuse configuration with a real call", () => {
    expect(engineVerificationLabel(undefined, "zh-CN")).toBe("配置就绪，尚无近期调用验证");
  });
  it("expires old evidence and rejects future timestamps", () => {
    const checks = { chat: { state: "verified" as const, checked_at: 1000 } };
    expect(engineVerificationLabel(checks, "zh-CN", 1001_000)).toBe("最近会话调用通过");
    expect(engineVerificationLabel(checks, "zh-CN", 1300_000)).toBe("配置就绪，尚无近期调用验证");
    expect(engineVerificationLabel(checks, "zh-CN", 999_000)).toBe("配置就绪，尚无近期调用验证");
  });
  it("reports failure as recent evidence with retry available", () => {
    expect(engineVerificationLabel({ chat: { state: "failed", checked_at: 1000 } }, "en-US", 1001_000))
      .toBe("Recent session call failed; retry available");
  });
  it("speaks Japanese and Korean too", () => {
    expect(engineVerificationLabel(undefined, "ja-JP")).toBe("設定済み。最近の呼び出し検証はまだありません");
    expect(engineVerificationLabel(undefined, "ko-KR")).toBe("구성 완료, 최근 호출 검증 없음");
  });
});
