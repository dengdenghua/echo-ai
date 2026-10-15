import { describe, expect, it } from "vitest";

import { getAboutMarkdown } from "./about-content";

describe("localized About content", () => {
  it.each(["en-US", "zh-CN", "ja-JP", "ko-KR"])(
    "keeps %s aligned with the shipped license and frontend stack",
    (locale) => {
      const content = getAboutMarkdown(locale);
      expect(content).toContain("Apache License 2.0");
      expect(content).toContain("React");
      expect(content).toContain("Vite");
      expect(content).not.toContain("MIT License");
      expect(content).not.toContain("Next.js");
      // Section headings are chrome: ECHO never uses emoji as icons.
      expect(content).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      // The page title is a plain heading, not an underlined link; the
      // repository stays under the project links section.
      const title = content.split("\n")[0] ?? "";
      expect(title).toMatch(/^# [^[\]()]+$/);
      expect(content).toContain("(https://github.com/dengdenghua/echo-ai)");
    },
  );
});
