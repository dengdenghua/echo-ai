import { describe, expect, it } from "vitest";

import { storeExtensionPage } from "./extension-links";

const ID = "bcjindcccaagfpapjjmafapmmgkkhgoa";

describe("storeExtensionPage", () => {
  it("recognizes extension detail pages of both stores", () => {
    expect(
      storeExtensionPage(
        `https://chromewebstore.google.com/detail/json-formatter/${ID}`,
      ),
    ).toEqual({ store: "chrome", id: ID });
    expect(
      storeExtensionPage(
        `https://microsoftedge.microsoft.com/addons/detail/x/${ID}?hl=zh-CN`,
      ),
    ).toEqual({ store: "edge", id: ID });
  });

  it("ignores store home pages, other sites and plain http", () => {
    expect(
      storeExtensionPage(
        "https://chromewebstore.google.com/category/extensions",
      ),
    ).toBe(null);
    expect(storeExtensionPage(`https://example.com/detail/x/${ID}`)).toBe(null);
    expect(
      storeExtensionPage(`http://chromewebstore.google.com/detail/x/${ID}`),
    ).toBe(null);
    expect(storeExtensionPage(undefined)).toBe(null);
  });
});
