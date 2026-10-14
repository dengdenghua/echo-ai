import { describe, expect, it } from "vitest";

import { detectProjectIntent } from "./project-intent";

describe("detectProjectIntent", () => {
  it("recognizes project creation intent without routing it automatically", () => {
    expect(detectProjectIntent("开一个智能床笠项目")).not.toBeNull();
    expect(detectProjectIntent("/project run\n开一个智能床笠项目")).toBeNull();
  });

  it("ignores ordinary project discussion and questions about the mode", () => {
    expect(detectProjectIntent("项目模式怎么用？")).toBeNull();
    expect(detectProjectIntent("帮我看一下这个项目的风险")).toBeNull();
  });
});
