import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskSideQuestion } from "./task-side-question";
const mock = vi.hoisted(() => ({
  fork: vi.fn(),
  send: vi.fn(),
  options: [] as unknown[],
  ready: true,
  messages: [],
}));
vi.mock("@/core/threads/hooks", () => ({
  useForkThread: () => ({
    mutate: mock.fork,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/core/threads/use-thread-stream-realtime", () => ({
  useThreadStreamRealtime: (options: unknown) => {
    mock.options.push(options);
    return [
      {
        readyForMutations: mock.ready,
        messages: mock.messages,
        isLoading: false,
        stop: vi.fn(),
      },
      mock.send,
      false,
      [],
      [],
      { pendingApprovals: [] },
    ];
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.options = [];
  mock.ready = true;
  mock.messages = [];
});
afterEach(cleanup);
function open(threadId = "parent", text = "quoted") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("echo:side-question", { detail: { threadId, text } }),
    );
  });
}
it("only creates a child after the user sends; never sends to the parent", () => {
  mock.fork.mockImplementation((_args, callbacks) => {
    callbacks.onSuccess({ thread_id: "child" });
    callbacks.onSettled();
  });
  render(<TaskSideQuestion threadId="parent" engine="codex" />);
  open("other");
  expect(screen.queryByLabelText("追问内容")).toBeNull();
  open();
  expect(mock.fork).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("追问内容"), {
    target: { value: "why?" },
  });
  fireEvent.click(screen.getByText("发送追问"));
  expect(mock.fork).toHaveBeenCalledOnce();
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.send.mock.calls[0]?.[0]).toBe("child");
  expect(mock.send.mock.calls[0]?.[1].text).toContain("why?");
  expect(mock.options.at(-1)).toMatchObject({
    context: { permission_mode: "plan", parent_thread_id: "parent" },
  });
  fireEvent.click(screen.getByLabelText("收起旁路追问"));
  expect(screen.queryByLabelText("旁路追问")).not.toBeVisible();
  fireEvent.click(screen.getByText("继续旁路追问"));
  expect(mock.send).toHaveBeenCalledOnce();
});
it("drops a late fork response after the parent task changes", () => {
  let complete: (value: { thread_id: string }) => void = () => undefined;
  mock.fork.mockImplementation((_args, callbacks) => {
    complete = callbacks.onSuccess;
  });
  const view = render(<TaskSideQuestion threadId="parent" engine="echo" />);
  open();
  fireEvent.change(screen.getByLabelText("追问内容"), {
    target: { value: "why?" },
  });
  fireEvent.click(screen.getByText("发送追问"));
  view.rerender(<TaskSideQuestion threadId="other" engine="echo" />);
  act(() => complete({ thread_id: "old-child" }));
  expect(mock.send).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("旁路追问")).toBeNull();
});

it("can dismiss the collapsed entry and reopen explicitly without sending", () => {
  render(<TaskSideQuestion threadId="parent" engine="echo" />);
  open();
  fireEvent.click(screen.getByLabelText("收起旁路追问"));
  fireEvent.click(screen.getByRole("button", { name: "关闭旁路追问" }));
  expect(screen.queryByRole("button", { name: "继续旁路追问" })).toBeNull();
  open("parent", "new quote");
  expect(screen.getByLabelText("追问内容")).toBeVisible();
  expect(screen.getByText("new quote")).toBeVisible();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.fork).not.toHaveBeenCalled();
});

it("closing an existing side conversation does not resend it on reopening", () => {
  mock.fork.mockImplementation((_args, callbacks) => {
    callbacks.onSuccess({ thread_id: "child" });
    callbacks.onSettled();
  });
  render(<TaskSideQuestion threadId="parent" engine="echo" />);
  open();
  fireEvent.change(screen.getByLabelText("追问内容"), { target: { value: "why?" } });
  fireEvent.click(screen.getByText("发送追问"));
  fireEvent.click(screen.getByRole("button", { name: "关闭旁路追问" }));
  expect(screen.queryByRole("button", { name: "继续旁路追问" })).toBeNull();
  open();
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.fork).toHaveBeenCalledOnce();
});
