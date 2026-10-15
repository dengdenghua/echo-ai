import { describe, expect, it } from "vitest";

import { deriveThreadTitle, threadHeadline } from "./sidebar";

describe("thread title fallback", () => {
  it("turns a long instruction into its headline", () => {
    expect(
      threadHeadline(
        "在当前文件夹里创建 hello.py：打印 Hello Echo 和当前时间，然后运行它确认输出；最后写一个 README.md",
      ),
    ).toBe("在当前文件夹里创建 hello.py");
    expect(threadHeadline("Fix the login bug. It fails on Safari.")).toBe(
      "Fix the login bug",
    );
  });

  it("keeps a short prompt whole and cuts an unbroken one with an ellipsis", () => {
    expect(threadHeadline("你好，用一句话介绍你自己")).toBe(
      "你好，用一句话介绍你自己",
    );
    const long = threadHeadline("长".repeat(80));
    expect(long).toHaveLength(32);
    expect(long.endsWith("…")).toBe(true);
  });

  it("uses the headline for a message-derived title but keeps a real title", () => {
    const messages = [
      {
        type: "human",
        content: "在当前文件夹里创建 hello.py：打印 Hello Echo 和当前时间",
      },
    ];
    expect(deriveThreadTitle({ thread_id: "t1", values: { messages } })).toBe(
      "在当前文件夹里创建 hello.py",
    );
    expect(
      deriveThreadTitle({
        thread_id: "t1",
        metadata: { title: "Hello 脚本：创建、运行与说明" },
        values: { messages },
      }),
    ).toBe("Hello 脚本：创建、运行与说明");
  });
});
