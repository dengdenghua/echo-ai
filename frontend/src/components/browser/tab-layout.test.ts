import { describe, expect, it } from "vitest";

import {
  arrangeTabs,
  clampSplitRatio,
  moveTab,
  nearestOutsideGroup,
  nextGroupColor,
  pruneGroups,
  validSplit,
  type BrowserTabGroup,
} from "./tab-layout";

type Tab = { id: string; pinned?: boolean; groupId?: string };
const ids = (tabs: Tab[]) =>
  tabs.map((tab) => (tab.groupId ? `${tab.id}:${tab.groupId}` : tab.id));
const group = (id: string, color: BrowserTabGroup["color"] = "blue") => ({
  id,
  title: "",
  color,
  collapsed: false,
});

describe("arrangeTabs", () => {
  it("keeps pinned tabs first and group members together", () => {
    const tabs: Tab[] = [
      { id: "a", groupId: "g" },
      { id: "b" },
      { id: "p", pinned: true },
      { id: "c", groupId: "g" },
    ];
    expect(ids(arrangeTabs(tabs))).toEqual(["p", "a:g", "c:g", "b"]);
  });

  it("drops the group of a pinned tab", () => {
    expect(ids(arrangeTabs([{ id: "p", pinned: true, groupId: "g" }]))).toEqual(
      ["p"],
    );
  });
});

describe("moveTab", () => {
  const tabs: Tab[] = [
    { id: "a" },
    { id: "b", groupId: "g" },
    { id: "c", groupId: "g" },
    { id: "d" },
  ];

  it("joins a group when dropped between two of its tabs", () => {
    expect(ids(moveTab(tabs, 0, 1))).toEqual(["b:g", "a:g", "c:g", "d"]);
  });

  it("stays in its group when moved inside it", () => {
    expect(ids(moveTab(tabs, 2, 1))).toEqual(["a", "c:g", "b:g", "d"]);
  });

  it("leaves its group when dropped elsewhere", () => {
    expect(ids(moveTab(tabs, 1, 3))).toEqual(["a", "c:g", "d", "b"]);
  });
});

describe("pruneGroups", () => {
  it("removes empty groups and unknown group ids", () => {
    const result = pruneGroups(
      [
        { id: "a", groupId: "g" },
        { id: "b", groupId: "missing" },
      ],
      [group("g"), group("empty")],
    );
    expect(ids(result.tabs)).toEqual(["a:g", "b"]);
    expect(result.groups.map((g) => g.id)).toEqual(["g"]);
  });
});

describe("split and helpers", () => {
  it("drops a split whose tab is gone and clamps the ratio", () => {
    const tabs = [{ id: "a" }, { id: "b" }];
    expect(
      validSplit({ leftId: "a", rightId: "b", ratio: 0.95 }, tabs),
    ).toEqual({ leftId: "a", rightId: "b", ratio: 0.8 });
    expect(validSplit({ leftId: "a", rightId: "x", ratio: 0.5 }, tabs)).toBe(
      null,
    );
    expect(validSplit({ leftId: "a", rightId: "a", ratio: 0.5 }, tabs)).toBe(
      null,
    );
    expect(clampSplitRatio(Number.NaN)).toBe(0.5);
  });

  it("picks the least used color", () => {
    expect(nextGroupColor([])).toBe("blue");
    expect(nextGroupColor([group("1", "blue")])).toBe("red");
  });

  it("finds the nearest tab outside a group", () => {
    const tabs: Tab[] = [
      { id: "a" },
      { id: "b", groupId: "g" },
      { id: "c", groupId: "g" },
      { id: "d" },
    ];
    expect(nearestOutsideGroup(tabs, "c", "g")?.id).toBe("d");
    expect(nearestOutsideGroup(tabs, "b", "g")?.id).toBe("a");
    expect(nearestOutsideGroup([{ id: "x", groupId: "g" }], "x", "g")).toBe(
      null,
    );
  });
});
