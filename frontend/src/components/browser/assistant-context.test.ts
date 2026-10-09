import { describe, expect, it } from "vitest";

import {
  BROWSER_ACTION_PROTOCOL,
  USER_REQUEST_MARKER,
  pageContextBlock,
  visibleUserText,
  withModelContext,
} from "./agentic-actions";

describe("model context around a request", () => {
  it("sends context before the marker and shows only the request", () => {
    const page = pageContextBlock("[当前页面]", {
      url: "https://example.com/",
      title: "Example",
      // Page text may itself contain markdown rules.
      text: "intro\n---\nmore",
    });
    const sent = withModelContext([BROWSER_ACTION_PROTOCOL, page], "总结一下");

    expect(sent).toContain(USER_REQUEST_MARKER);
    expect(sent).toContain("URL：https://example.com/");
    expect(visibleUserText(sent)).toBe("总结一下");
  });

  it("leaves a plain message alone", () => {
    expect(withModelContext([], "你好")).toBe("你好");
    expect(visibleUserText("你好")).toBe("你好");
  });

  it("caps a long page and notes the original length", () => {
    const block = pageContextBlock(
      "[另一个标签页] Docs",
      { url: "https://docs.example/", title: "Docs", text: "x".repeat(50) },
      { maxChars: 10 },
    );
    expect(block).toContain(`${"x".repeat(10)}\n[…已截断，原文 50 字符]`);
  });

  it("still hides the protocol in messages sent before the marker", () => {
    expect(
      visibleUserText(`${BROWSER_ACTION_PROTOCOL}\n\n---\n\n总结这个页面`),
    ).toBe("总结这个页面");
  });
});
