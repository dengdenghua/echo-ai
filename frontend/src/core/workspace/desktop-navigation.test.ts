import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_PINS,
  parseDesktopPins,
  toggleDesktopPin,
} from "./desktop-navigation";

describe("saved desktop navigation", () => {
  it("offers six defaults without replacing saved choices or sharing mutable defaults", () => {
    expect(parseDesktopPins(null)).toEqual(["chat", "projects", "local-knowledge", "library.docs", "assistant", "intelligence"]);
    expect(parseDesktopPins('["hr"]')).toEqual(["hr"]);
    const first = parseDesktopPins(null);
    first.pop();
    expect(parseDesktopPins(null)).toHaveLength(6);
    expect(toggleDesktopPin(parseDesktopPins(null), "chat")).not.toContain("chat");
  });
  it("recovers from corrupt preferences but preserves an intentionally empty rail", () => {
    expect(parseDesktopPins("not json")).toEqual(DEFAULT_DESKTOP_PINS);
    expect(parseDesktopPins('{"mail":true}')).toEqual(DEFAULT_DESKTOP_PINS);
    expect(parseDesktopPins("[]")).toEqual([]);
  });
  it("ignores malformed and duplicate entries from storage", () => {
    expect(parseDesktopPins('[null,3,"mail","mail","","assistant"]')).toEqual([
      "mail",
      "assistant",
    ]);
  });
  it("preserves more than eight pins and supports removing and restoring them", () => {
    const full = Array.from({ length: 8 }, (_, i) => `app-${i}`);
    expect(toggleDesktopPin(full, "mail")).toEqual([...full, "mail"]);
    const removed = toggleDesktopPin(full, "app-3");
    expect(toggleDesktopPin(removed, "mail")).toEqual([...removed, "mail"]);
    expect(parseDesktopPins(JSON.stringify([...full, "extra"]))).toEqual([...full, "extra"]);
  });
});
