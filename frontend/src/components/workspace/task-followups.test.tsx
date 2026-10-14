import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskFollowups } from "./task-followups";
import {
  PAUSE_FOLLOWUPS_EVENT,
  STEER_RECEIPT_EVENT,
  queueFollowup,
} from "@/core/threads/task-interaction";
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);
const base = { threadId: "a", running: true, ready: true, failed: false };
it("sends FIFO, one item per completed response, never on a rerender", () => {
  const send = vi.fn();
  const view = render(<TaskFollowups {...base} onSend={send} />);
  act(() => {
    expect(queueFollowup("a", "first")).toBe(true);
    queueFollowup("a", "second");
  });
  expect(send).not.toHaveBeenCalled();
  view.rerender(<TaskFollowups {...base} running={false} onSend={send} />);
  expect(send).toHaveBeenCalledExactlyOnceWith({ text: "first" });
  view.rerender(<TaskFollowups {...base} running={false} onSend={send} />);
  expect(send).toHaveBeenCalledTimes(1);
  view.rerender(<TaskFollowups {...base} onSend={send} />);
  view.rerender(<TaskFollowups {...base} running={false} onSend={send} />);
  expect(send).toHaveBeenLastCalledWith({ text: "second" });
});
it("retains queued work offline and resumes after reconciliation", () => {
  const send = vi.fn();
  const view = render(<TaskFollowups {...base} onSend={send} />);
  act(() => {
    queueFollowup("a", "later");
  });
  view.rerender(
    <TaskFollowups {...base} running={false} ready={false} onSend={send} />,
  );
  expect(send).not.toHaveBeenCalled();
  view.rerender(<TaskFollowups {...base} running={false} onSend={send} />);
  expect(send).toHaveBeenCalledOnce();
});
it.each(["failure", "stop"])(
  "pauses on %s, preserving explicit resume",
  (reason) => {
    const send = vi.fn();
    const view = render(<TaskFollowups {...base} onSend={send} />);
    act(() => {
      queueFollowup("a", "later");
    });
    if (reason === "stop")
      act(() => {
        window.dispatchEvent(
          new CustomEvent(PAUSE_FOLLOWUPS_EVENT, { detail: { threadId: "a" } }),
        );
      });
    view.rerender(
      <TaskFollowups
        {...base}
        running={false}
        failed={reason === "failure"}
        onSend={send}
      />,
    );
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("继续队列"));
    expect(send).toHaveBeenCalledOnce();
  },
);
it("restores paused, edits and removes without sending", () => {
  sessionStorage.setItem(
    "echo:followups:a",
    JSON.stringify([{ id: "x", text: "old" }]),
  );
  const send = vi.fn();
  render(<TaskFollowups {...base} running={false} onSend={send} />);
  fireEvent.click(screen.getByText("修改"));
  fireEvent.change(screen.getByLabelText("修改待执行消息"), {
    target: { value: "updated" },
  });
  fireEvent.click(screen.getByText("保存"));
  expect(sessionStorage.getItem("echo:followups:a")).toContain("updated");
  fireEvent.click(screen.getByText("移除"));
  expect(send).not.toHaveBeenCalled();
});
it("isolates thread queues and real service receipts", () => {
  const send = vi.fn();
  const view = render(<TaskFollowups {...base} onSend={send} />);
  act(() => {
    queueFollowup("a", "only a");
  });
  view.rerender(
    <TaskFollowups {...base} threadId="b" running={false} onSend={send} />,
  );
  expect(screen.queryByText("only a")).toBeNull();
  act(() => {
    window.dispatchEvent(
      new CustomEvent(STEER_RECEIPT_EVENT, { detail: { threadId: "a" } }),
    );
  });
  expect(screen.queryByRole("status")).toBeNull();
  act(() => {
    window.dispatchEvent(
      new CustomEvent(STEER_RECEIPT_EVENT, { detail: { threadId: "b" } }),
    );
  });
  expect(screen.getByRole("status")).toHaveTextContent("服务端接收");
  expect(send).not.toHaveBeenCalled();
});
it("restores a message rejected by the send boundary", () => {
  const send = vi.fn(() => false);
  const view = render(<TaskFollowups {...base} onSend={send} />);
  act(() => {
    queueFollowup("a", "keep");
  });
  view.rerender(<TaskFollowups {...base} running={false} onSend={send} />);
  expect(screen.getByText("keep")).toBeInTheDocument();
  expect(screen.getByText("继续队列")).toBeInTheDocument();
});
