import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemberReadingPosition, type MemberReadingPositions } from "./use-member-reading-position";

function Reader({ id, positions, revision = 0 }: { id: string; positions: MemberReadingPositions; revision?: number }) {
  const { containerRef, showLatest, scrollToLatest } = useMemberReadingPosition(id, positions, revision, true);
  return <><div ref={containerRef} data-testid="scroll"><div>content</div></div>{showLatest && <button onClick={scrollToLatest}>latest</button>}</>;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
});
afterEach(() => vi.restoreAllMocks());

it("restores each task's position and keeps new output from stealing the reading position", () => {
  const positions: MemberReadingPositions = new Map();
  const view = render(<Reader key="a" id="a" positions={positions} />);
  const scroll = screen.getByTestId("scroll");
  scroll.scrollTop = 230;
  fireEvent.scroll(scroll);
  view.rerender(<Reader key="b" id="b" positions={positions} />);
  screen.getByTestId("scroll").scrollTop = 520;
  fireEvent.scroll(screen.getByTestId("scroll"));
  view.rerender(<Reader key="a" id="a" positions={positions} />);
  expect(screen.getByTestId("scroll").scrollTop).toBe(230);
  view.rerender(<Reader key="a" id="a" positions={positions} revision={1} />);
  expect(screen.getByTestId("scroll").scrollTop).toBe(230);
  fireEvent.click(screen.getByRole("button", { name: "latest" }));
  expect(screen.getByTestId("scroll").scrollTop).toBe(1200);
  expect(screen.queryByRole("button", { name: "latest" })).not.toBeInTheDocument();
});

it("keeps a reopened panel's position and isolates conversations and new task instances", () => {
  const positions: MemberReadingPositions = new Map([["thread-a:member:task-1", { top: 300, following: false, taskOpen: true }]]);
  const view = render(<Reader key="old" id="thread-a:member:task-1" positions={positions} />);
  expect(screen.getByTestId("scroll").scrollTop).toBe(300);
  view.rerender(<></>);
  view.rerender(<Reader key="old" id="thread-a:member:task-1" positions={positions} />);
  expect(screen.getByTestId("scroll").scrollTop).toBe(300);
  expect(positions.get("thread-a:member:task-1")?.taskOpen).toBe(true);
  view.rerender(<Reader key="new" id="thread-b:member:task-1" positions={positions} />);
  expect(screen.getByTestId("scroll").scrollTop).toBe(1200);
});
