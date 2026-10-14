import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

type MenuEntry = {
  label?: string;
  type?: string;
  checked?: boolean;
  submenu?: MenuEntry[];
  click?: () => void;
};

// Pure helpers of the desktop shell's extension host (CommonJS).
const compat = createRequire(import.meta.url)(
  "../../../electron/extension-compat.cjs",
) as {
  matchPattern(pattern: string, url: string): boolean;
  matchesTabQuery(tab: Record<string, unknown>, query: object): boolean;
  clickContexts(params: object): Set<string>;
  contextMenuTemplate(
    extensions: { id: string; name: string; items: object[] }[],
    params: object,
    onClick: (id: string, item: { id: string }) => void,
    contexts?: Set<string>,
  ): MenuEntry[];
  menuClickInfo(item: object, params: object, wasChecked: boolean): object;
  pickIconPath(manifest: object): string | null;
  cssColor(color: unknown): string | undefined;
  effectiveAction(
    state: { global: object; tabs: Map<number, object> } | undefined,
    tabId: number | null,
  ): Record<string, unknown>;
  popupBounds(input: object): {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

describe("match patterns", () => {
  it("follows Chrome's scheme, host and path rules", () => {
    expect(compat.matchPattern("<all_urls>", "https://a.com/x")).toBe(true);
    expect(compat.matchPattern("<all_urls>", "chrome-extension://x/")).toBe(
      false,
    );
    expect(compat.matchPattern("*://*.example.com/*", "http://a.example.com/p")).toBe(true);
    expect(compat.matchPattern("*://*.example.com/*", "https://example.com/")).toBe(true);
    expect(compat.matchPattern("*://*.example.com/*", "https://badexample.com/")).toBe(false);
    expect(compat.matchPattern("*://*/*", "ftp://a.com/")).toBe(false);
    expect(compat.matchPattern("https://a.com/docs/*", "https://a.com/docs/1?q=2")).toBe(true);
    expect(compat.matchPattern("https://a.com/docs/*", "https://a.com/blog")).toBe(false);
    expect(compat.matchPattern("not a pattern", "https://a.com/")).toBe(false);
  });
});

describe("tabs.query filter", () => {
  const tab = {
    id: 7,
    index: 0,
    windowId: 1,
    active: true,
    highlighted: true,
    pinned: false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    mutedInfo: { muted: false },
    status: "complete",
    url: "https://docs.example.com/guide",
    title: "Guide — Docs",
  };

  it("matches the usual active-tab query", () => {
    expect(
      compat.matchesTabQuery(tab, { active: true, currentWindow: true }),
    ).toBe(true);
    expect(
      compat.matchesTabQuery({ ...tab, active: false }, { active: true }),
    ).toBe(false);
    expect(compat.matchesTabQuery(tab, { windowId: -2 })).toBe(true);
    expect(compat.matchesTabQuery(tab, { windowId: 5 })).toBe(false);
    expect(compat.matchesTabQuery(tab, { currentWindow: false })).toBe(false);
  });

  it("filters by url patterns and title globs", () => {
    expect(
      compat.matchesTabQuery(tab, { url: ["*://*.example.com/*"] }),
    ).toBe(true);
    expect(compat.matchesTabQuery(tab, { url: "*://other.com/*" })).toBe(false);
    expect(compat.matchesTabQuery(tab, { title: "guide*" })).toBe(true);
    expect(compat.matchesTabQuery(tab, { title: "Blog*" })).toBe(false);
  });
});

describe("extension context menus", () => {
  const items = [
    { id: "save", title: "Save page", contexts: ["page"] },
    { id: "lookup", title: "Look up “%s”", contexts: ["selection"] },
    { id: "links", title: "Link tools", contexts: ["link"] },
    { id: "copy-link", parentId: "links", title: "Copy link" },
    { id: "docs-only", title: "Docs", documentUrlPatterns: ["*://docs.test/*"] },
    { id: "hidden", title: "Hidden", visible: false },
    { id: "on-action", title: "Action item", contexts: ["action"] },
  ];

  it("reads the click's contexts", () => {
    expect([...compat.clickContexts({ pageURL: "https://a.com/" })]).toEqual([
      "all",
      "page",
    ]);
    const contexts = compat.clickContexts({
      selectionText: " words ",
      linkURL: "https://a.com/l",
    });
    expect(contexts.has("selection") && contexts.has("link")).toBe(true);
    expect(contexts.has("page")).toBe(false);
  });

  it("shows the items that apply, grouped under the extension", () => {
    const onClick = vi.fn();
    const template = compat.contextMenuTemplate(
      [{ id: "ext", name: "Tools", items }],
      { pageURL: "https://a.com/", selectionText: "hello world", linkURL: "https://a.com/l" },
      onClick,
    );
    expect(template).toHaveLength(1);
    const group = template[0]!;
    expect(group.label).toBe("Tools");
    expect(group.submenu!.map((entry) => entry.label)).toEqual([
      "Look up “hello world”",
      "Link tools",
    ]);
    // Children inherit the parent's contexts.
    const child = group.submenu![1]!.submenu![0]!;
    expect(child.label).toBe("Copy link");
    child.click!();
    expect(onClick).toHaveBeenCalledWith("ext", expect.objectContaining({ id: "copy-link" }));
  });

  it("keeps a single item at the top level and honours page patterns", () => {
    const template = compat.contextMenuTemplate(
      [{ id: "ext", name: "Tools", items }],
      { pageURL: "https://docs.test/a" },
      () => {},
    );
    expect(template.map((entry) => entry.label)).toEqual(["Tools"]);
    expect(template[0]!.submenu!.map((entry) => entry.label)).toEqual([
      "Save page",
      "Docs",
    ]);
    const plain = compat.contextMenuTemplate(
      [{ id: "ext", name: "Tools", items }],
      { pageURL: "https://a.com/" },
      () => {},
    );
    expect(plain.map((entry) => entry.label)).toEqual(["Save page"]);
  });

  it("builds the toolbar button's menu from action items", () => {
    const template = compat.contextMenuTemplate(
      [{ id: "ext", name: "Tools", items }],
      { pageURL: "https://a.com/" },
      () => {},
      new Set(["all", "action"]),
    );
    expect(template.map((entry) => entry.label)).toEqual(["Action item"]);
  });

  it("reports checkbox state in the click info", () => {
    expect(
      compat.menuClickInfo(
        { id: "c", type: "checkbox" },
        { pageURL: "https://a.com/", selectionText: "x", isEditable: false },
        false,
      ),
    ).toEqual({
      menuItemId: "c",
      editable: false,
      pageUrl: "https://a.com/",
      selectionText: "x",
      wasChecked: false,
      checked: true,
    });
  });
});

describe("toolbar action state", () => {
  it("picks the icon nearest 32px, action icon first", () => {
    expect(
      compat.pickIconPath({
        action: { default_icon: { 16: "a16.png", 48: "a48.png" } },
        icons: { 128: "i128.png" },
      }),
    ).toBe("a48.png");
    expect(compat.pickIconPath({ icons: { 16: "i16.png" } })).toBe("i16.png");
    expect(compat.pickIconPath({ browser_action: { default_icon: "b.png" } })).toBe("b.png");
    expect(compat.pickIconPath({})).toBeNull();
  });

  it("lets a tab's values override the extension-wide ones", () => {
    const state = {
      global: { badgeText: "3", title: "All" },
      tabs: new Map([[9, { badgeText: "9" }]]),
    };
    expect(compat.effectiveAction(state, 9)).toEqual({ badgeText: "9", title: "All" });
    expect(compat.effectiveAction(state, 1)).toEqual({ badgeText: "3", title: "All" });
    expect(compat.effectiveAction(undefined, 1)).toEqual({});
  });

  it("converts badge colours", () => {
    expect(compat.cssColor("#f00")).toBe("#f00");
    expect(compat.cssColor([255, 0, 0, 255])).toBe("rgba(255, 0, 0, 1)");
    expect(compat.cssColor(null)).toBeUndefined();
  });

  it("places a popup under its button, inside the screen", () => {
    expect(
      compat.popupBounds({
        anchor: { left: 900, top: 10, right: 932, bottom: 42 },
        contentBounds: { x: 100, y: 50, width: 1200, height: 800 },
        zoom: 1,
        size: { width: 300, height: 2000 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }),
    ).toEqual({ x: 732, y: 96, width: 300, height: 600 });
    expect(
      compat.popupBounds({
        anchor: { left: 0, top: 0, right: 40, bottom: 30 },
        contentBounds: { x: 0, y: 0, width: 800, height: 600 },
        size: { width: 400, height: 10 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }),
    ).toEqual({ x: 0, y: 34, width: 400, height: 25 });
  });
});
