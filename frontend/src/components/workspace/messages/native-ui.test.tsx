import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/core/api/types";
import type { UIDocument } from "@/core/messages/native-ui";
import {
  parseUIDocument,
  parseUIReceipt,
  readUIFormState,
  saveUIFormState,
} from "@/core/messages/native-ui";
import {
  QUICK_REPLY_EVENT,
  type QuickReplyDetail,
} from "@/core/messages/quick-reply";
import { NativeUIMessages } from "./native-ui";
import {
  ThreadMessagesContext,
  ThreadMetaContext,
  ThreadValuesContext,
} from "./context";

const identity = vi.hoisted(() => ({ user: "alice" }));
vi.mock("@/providers/AuthProvider", () => ({
  useOptionalAuth: () => ({ user: { user_id: identity.user } }),
}));

const document: UIDocument = {
  version: 1,
  title: "开始项目",
  blocks: [
    {
      id: "form",
      type: "form",
      title: "项目需求",
      fields: [
        { id: "name", type: "text", label: "项目名称", required: true },
        {
          id: "mode",
          type: "select",
          label: "方式",
          options: ["本地", "远程"],
        },
      ],
    },
    { id: "plan", type: "tasks", title: "任务安排" },
  ],
};

function toolMessages(
  doc: unknown = document,
  result: unknown = {
    ok: true,
    kind: "echo.ui.v1",
    thread_id: "t1",
    version: 1,
    status: "ready",
  },
): Message[] {
  return [
    {
      type: "ai",
      id: "ai",
      content: "",
      tool_calls: [{ id: "call", name: "show_ui", args: { document: doc } }],
    },
    ...(result === null
      ? []
      : [
          {
            type: "tool",
            id: "result",
            tool_call_id: "call",
            content: `(real tool execution succeeded) show_ui\n${JSON.stringify(result)}`,
          },
        ]),
  ] as Message[];
}
function View({
  messages = toolMessages(),
  all = messages,
  threadId = "t1",
  todos = [],
}: {
  messages?: Message[];
  all?: Message[];
  threadId?: string;
  todos?: { content: string; status: string }[];
}) {
  return (
    <ThreadMetaContext.Provider value={{ threadId }}>
      <ThreadMessagesContext.Provider value={{ messages: all }}>
        <ThreadValuesContext.Provider
          value={{ values: { messages: all, todos } as never }}
        >
          <NativeUIMessages messages={messages} />
        </ThreadValuesContext.Provider>
      </ThreadMessagesContext.Provider>
    </ThreadMetaContext.Provider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  identity.user = "alice";
  window.history.replaceState({}, "", "/");
});

describe("native UI safety", () => {
  it("rejects scripts, actions, duplicate ids, fabricated task status and malformed comparisons", () => {
    for (const block of [
      { ...document.blocks[0], action: { tool: "invite" } },
      { ...document.blocks[1], status: "completed" },
      { id: "text", type: "text", text: "hi", script: "alert(1)" },
      {
        id: "table",
        type: "comparison",
        title: "对比",
        columns: ["A", "B"],
        rows: [["A"]],
      },
    ])
      expect(parseUIDocument({ ...document, blocks: [block] })).toBeNull();
    expect(
      parseUIDocument({
        ...document,
        blocks: [document.blocks[0], document.blocks[0]],
      }),
    ).toBeNull();
    expect(
      parseUIReceipt({
        ok: false,
        kind: "echo.ui.v1",
        thread_id: "t1",
        document,
      }),
    ).toBeNull();
  });

  it("never activates previews, rejected results or receipts belonging to a private conversation", () => {
    const view = render(<View messages={toolMessages(document, null)} />);
    expect(
      screen.getByRole("button", { name: "发送到当前对话" }),
    ).toBeDisabled();
    view.rerender(<View messages={toolMessages(document, { ok: false })} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    view.rerender(<View threadId="other" />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("renders user supplied markup as inert text", () => {
    const doc = {
      ...document,
      blocks: [
        { id: "t", type: "text", text: '<img src="x" onerror="alert(1)">' },
      ],
    };
    const { container } = render(<View messages={toolMessages(doc)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });
});

describe("native form lifecycle", () => {
  it("preserves drafts across stream updates/remounts, and isolates actor, host and thread", () => {
    let view = render(<View />);
    fireEvent.change(screen.getByLabelText(/项目名称/), {
      target: { value: "Echo" },
    });
    const doc = {
      ...document,
      blocks: [
        ...document.blocks,
        { id: "new", type: "text" as const, text: "补充说明" },
      ],
    };
    view.rerender(<View messages={toolMessages(doc)} />);
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("Echo");
    view.unmount();
    view = render(<View />);
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("Echo");
    identity.user = "bob";
    view.rerender(<View />);
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("");
    identity.user = "alice";
    window.history.replaceState({}, "", "/?echoRemote=nas");
    view.rerender(<View />);
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("");
    window.history.replaceState({}, "", "/");
    view.rerender(
      <View
        threadId="t2"
        messages={toolMessages(document, {
          ok: true,
          kind: "echo.ui.v1",
          thread_id: "t2",
          document,
        })}
      />,
    );
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("");
  });

  it("sends once, waits for server acknowledgement, and recovers pending after remount", () => {
    const sent: QuickReplyDetail[] = [];
    const listener = (event: Event) => {
      sent.push((event as CustomEvent<QuickReplyDetail>).detail);
      event.preventDefault();
    };
    window.addEventListener(QUICK_REPLY_EVENT, listener);
    try {
      let view = render(<View />);
      fireEvent.change(screen.getByLabelText(/项目名称/), {
        target: { value: "Echo" },
      });
      fireEvent.click(screen.getByRole("button", { name: "发送到当前对话" }));
      fireEvent.submit(screen.getByRole("form"));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        threadId: "t1",
        text: "表单回复：项目需求\n项目名称：Echo\n方式：未填写",
      });
      expect(screen.getByRole("button", { name: "等待回执" })).toBeDisabled();
      const human = {
        id: sent[0]!.clientMessageId,
        type: "human",
        content: "reply",
        additional_kwargs: { delivery_state: "sending" },
      } as Message;
      view.rerender(<View all={[human]} />);
      expect(screen.queryByText("已收到")).not.toBeInTheDocument();
      view.unmount();
      view = render(<View />);
      expect(screen.getByRole("button", { name: "等待回执" })).toBeDisabled();
      expect(sent).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "重试发送" }));
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      view.rerender(<View all={[{ ...human, additional_kwargs: {} }]} />);
      expect(screen.getByRole("button", { name: "已收到" })).toBeDisabled();
    } finally {
      window.removeEventListener(QUICK_REPLY_EVENT, listener);
    }
  });

  it("keeps the draft editable if the conversation cannot accept it", () => {
    render(<View />);
    fireEvent.change(screen.getByLabelText(/项目名称/), {
      target: { value: "Echo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送到当前对话" }));
    expect(screen.getByRole("alert")).toHaveTextContent("填写内容已保留");
    expect(screen.getByLabelText(/项目名称/)).toBeEnabled();
    expect(screen.getByLabelText(/项目名称/)).toHaveValue("Echo");
  });

  it("rejects stale drafts after a form schema change and handles unavailable storage", () => {
    saveUIFormState("test", "v1", { values: { name: "Echo" } });
    expect(readUIFormState("test", "v2").values).toEqual({});
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() => saveUIFormState("test", "v1", { values: {} })).not.toThrow();
    spy.mockRestore();
  });
});

it("uses server-provided task records, including empty and changing plans", () => {
  const view = render(<View />);
  expect(screen.getByText("暂无任务记录")).toBeInTheDocument();
  view.rerender(
    <View
      todos={[
        { content: "需求确认", status: "completed" },
        { content: "原型", status: "in_progress" },
      ]}
    />,
  );
  expect(screen.getByText("计划完成 1/2")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
});
