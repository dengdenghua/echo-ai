import { describe, expect, it } from "vitest";

import { readerBlocks } from "./reader-view";

const PARAGRAPH =
  "A number of domains such as example.com and example.org are maintained for documentation purposes.";

describe("readerBlocks", () => {
  it("drops site navigation before the first paragraph", () => {
    const text = [
      "Domains",
      "Protocols",
      "Numbers",
      "Example Domains",
      PARAGRAPH,
      "Further Reading",
      "Special-Use Domain Names (RFC 6761)",
    ].join("\n");
    expect(readerBlocks(text, "Page")).toEqual([
      { text: "Example Domains", heading: true },
      { text: PARAGRAPH, heading: false },
      { text: "Further Reading", heading: false },
      { text: "Special-Use Domain Names (RFC 6761)", heading: false },
    ]);
  });

  it("drops the footer, even with a line of prose in it, and the title", () => {
    const links = ["About", "News", "Contact", "Privacy", "Terms", "Help"];
    const text = [
      "Example Domains",
      PARAGRAPH,
      "Section",
      PARAGRAPH,
      ...links,
      PARAGRAPH,
      "Privacy Policy",
    ].join("\n");
    expect(readerBlocks(text, "Example Domains")).toEqual([
      { text: PARAGRAPH, heading: false },
      { text: "Section", heading: true },
      { text: PARAGRAPH, heading: false },
    ]);
  });

  it("keeps a short list that more paragraphs follow", () => {
    const list = ["one", "two", "three", "four", "five", "six"];
    const text = [PARAGRAPH, ...list, PARAGRAPH, PARAGRAPH, PARAGRAPH].join(
      "\n",
    );
    expect(readerBlocks(text, "")).toHaveLength(10);
  });

  it("keeps everything when the page has no long paragraph", () => {
    expect(readerBlocks("第一行。\n第二行", "")).toEqual([
      { text: "第一行。", heading: false },
      { text: "第二行", heading: false },
    ]);
  });
});
