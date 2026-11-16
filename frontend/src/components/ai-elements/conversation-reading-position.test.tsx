import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readReadingPosition,
  saveReadingPosition,
} from "@/core/threads/conversation-view-state";

const context = vi.hoisted(() => ({
  scrollRef: { current: null as HTMLElement | null },
  contentRef: { current: null as HTMLElement | null },
  stopScroll: vi.fn(),
  scrollToBottom: vi.fn(),
}));
vi.mock("use-stick-to-bottom", () => ({
  StickToBottom: () => null,
  useStickToBottomContext: () => context,
}));
import { ConversationReadingPosition } from "./conversation";

describe("conversation restoration lifecycle", () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    root = document.createElement("div");
    root.innerHTML =
      '<div data-message-turn="human:a"><div data-message-group="assistant:a"><p>Reading</p></div></div>';
    document.body.append(root);
    Object.defineProperties(root, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height }) as DOMRect;
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(() =>
      rect(0, 200),
    );
    vi.spyOn(
      root.querySelector("p")!,
      "getBoundingClientRect",
    ).mockImplementation(() => rect(450 - root.scrollTop, 180));
    vi.spyOn(
      root.querySelector("[data-message-group]")!,
      "getBoundingClientRect",
    ).mockImplementation(() => rect(450 - root.scrollTop, 180));
    context.scrollRef.current = root;
    context.contentRef.current = root;
    saveReadingPosition("a", {
      top: 100,
      atBottom: false,
      groupId: "assistant:a",
      blockIndex: 0,
      offset: 50,
    });
  });
  afterEach(() => {
    root.remove();
    vi.useRealTimers();
  });

  it("waits for the authoritative snapshot and restores the anchor without overwriting it during hydration", () => {
    const { rerender, unmount } = render(
      <ConversationReadingPosition storageKey="a" ready={false} />,
    );
    expect(context.stopScroll).toHaveBeenCalled();
    expect(root.scrollTop).toBe(0);
    rerender(<ConversationReadingPosition storageKey="a" ready />);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(root.scrollTop).toBe(400);
    expect(readReadingPosition("a")?.offset).toBe(50);
    unmount();
    expect(readReadingPosition("a")?.top).toBe(400);
    expect(readReadingPosition("b")).toBeNull();
  });

  it("yields immediately to reader input rather than continuing to pin the restored anchor", () => {
    render(<ConversationReadingPosition storageKey="a" ready />);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    fireEvent.wheel(root, { deltaY: -100 });
    root.scrollTop = 200;
    fireEvent.scroll(root);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(root.scrollTop).toBe(200);
    expect(readReadingPosition("a")?.top).toBe(200);
  });
});
