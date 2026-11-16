import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureReadingPosition,
  readProcessChoice,
  readReadingPosition,
  restoreReadingPosition,
  saveProcessChoice,
  saveReadingPosition,
} from "./conversation-view-state";

describe("conversation reading state", () => {
  beforeEach(() => sessionStorage.clear());

  it("isolates disclosure and reading preferences by conversation and bounds history", () => {
    saveProcessChoice("a", "tool-1", false);
    saveProcessChoice("b", "tool-1", true);
    saveReadingPosition("a", { top: 400, atBottom: false });
    expect(readProcessChoice("a", "tool-1")).toBe(false);
    expect(readProcessChoice("b", "tool-1")).toBe(true);
    expect(readReadingPosition("b")).toBeNull();
    expect(readReadingPosition("a")?.top).toBe(400);
    saveProcessChoice("a", "tool-1", null);
    expect(readProcessChoice("a", "tool-1")).toBeNull();
    for (let i = 0; i < 40; i++)
      saveReadingPosition(`thread-${i}`, { top: i, atBottom: true });
    expect(readReadingPosition("a")).toBeNull();
    expect(readReadingPosition("thread-39")?.top).toBe(39);
  });

  it("restores a paragraph anchor when preceding content changes height", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-message-turn="human:one"><div data-message-group="assistant:answer"><p>First</p><p>Reading here</p></div></div>';
    root.scrollTop = 400;
    Object.defineProperties(root, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 2000 },
    });
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, height: bottom - top }) as DOMRect;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 300));
    const group = root.querySelector<HTMLElement>("[data-message-group]")!;
    vi.spyOn(group, "getBoundingClientRect").mockReturnValue(rect(-300, 500));
    const paragraphs = root.querySelectorAll("p");
    vi.spyOn(paragraphs[0]!, "getBoundingClientRect").mockReturnValue(
      rect(-300, -20),
    );
    const anchor = vi
      .spyOn(paragraphs[1]!, "getBoundingClientRect")
      .mockReturnValue(rect(-20, 200));
    const position = captureReadingPosition(root);
    expect(position).toMatchObject({
      groupId: "assistant:answer",
      turnId: "human:one",
      blockIndex: 1,
      offset: -20,
      atBottom: false,
    });
    // Earlier history grew by 150px. Raw scrollTop would restore the wrong text.
    anchor.mockReturnValue(rect(130, 350));
    expect(restoreReadingPosition(root, position)).toBe(true);
    expect(root.scrollTop).toBe(550);
  });

  it("tolerates corrupt and unavailable session storage", () => {
    sessionStorage.setItem("echo:conversation-view:v1", "invalid");
    expect(readReadingPosition("a")).toBeNull();
    const storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => saveProcessChoice("a", "g", true)).not.toThrow();
    storage.mockRestore();
  });
});
