import { describe, expect, it } from "vitest";

import { knowledgeMapCopy } from "./knowledge-map";

describe("knowledge map copy", () => {
  it("speaks the reader's language", () => {
    expect(knowledgeMapCopy("zh-CN").depthLocal(2)).toBe("局部 2 层");
    expect(knowledgeMapCopy("en-US").relationCount(1)).toBe("1 relation");
    expect(knowledgeMapCopy("en-US").relationCount(3)).toBe("3 relations");
    expect(knowledgeMapCopy("ja-JP").mapView).toBe("関係ビュー");
    expect(knowledgeMapCopy("ko-KR").mapView).toBe("관계 보기");
  });

  it("keeps the WebGL fallback readable instead of the raw renderer error", () => {
    for (const locale of ["zh-CN", "en-US", "ja-JP", "ko-KR"]) {
      const copy = knowledgeMapCopy(locale);
      expect(copy.webglUnavailable).not.toMatch(/WebGL|THREE/);
      for (const value of Object.values(copy)) {
        if (typeof value === "string") expect(value.trim()).not.toBe("");
      }
    }
  });
});
