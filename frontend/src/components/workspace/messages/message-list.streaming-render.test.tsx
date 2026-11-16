import type * as React from "react";
import { describe, expect, test, vi } from "vitest";

import type { Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type * as MessageUtils from "@/core/messages/utils";
import type { AgentThreadState } from "@/core/threads";
import { SubtasksProvider } from "@/core/tasks/context";
import { renderWithProviders } from "@/test/harness";

import { ThreadProviders } from "./context";
import { MessageList } from "./message-list";
import type * as MessageListItemModule from "./message-list-item";

const renderTracker = vi.hoisted(() => ({
  extractText: vi.fn(),
  itemRender: vi.fn(),
}));

vi.mock("@/core/messages/utils", async () => {
  const actual = await vi.importActual<typeof MessageUtils>(
    "@/core/messages/utils",
  );
  return {
    ...actual,
    extractTextFromMessage: (message: Message) => {
      renderTracker.extractText(String(message.id));
      return actual.extractTextFromMessage(message);
    },
  };
});

vi.mock("./message-list-item", async () => {
  const actual = await vi.importActual<typeof MessageListItemModule>(
    "./message-list-item",
  );
  const ReactModule = await import("react");
  const TrackedMessageListItem = ReactModule.memo(
    (props: {
      message: Message;
      messageIndex?: number;
      shadowReview?: unknown;
    }) => {
      renderTracker.itemRender(props);
      return ReactModule.createElement("div", {
        "data-testid": `message-${String(props.message.id)}`,
      });
    },
  );
  return { ...actual, MessageListItem: TrackedMessageListItem };
});

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({
    children,
    ...props
  }: React.ComponentProps<"div"> & { children?: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  ConversationContent: ({
    children,
    scrollClassName: _scrollClassName,
    ...props
  }: React.ComponentProps<"div"> & {
    children?: React.ReactNode;
    scrollClassName?: string;
  }) => <div {...props}>{children}</div>,
  ConversationScrollButton: ({
    activityKey: _activityKey,
    activityLabel: _activityLabel,
    children,
    ...props
  }: React.ComponentProps<"button"> & {
    activityKey?: string | number;
    activityLabel?: (count: number) => React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/core/settings", () => ({
  useLocalSettings: () => [
    {
      display: {
        chat_font_size: "medium",
      },
    },
    vi.fn(),
  ],
}));

function mockThread(
  messages: Message[],
  streamingMessage: Message | null,
  isLoading: boolean,
): BaseStream<AgentThreadState> {
  return {
    messages,
    streamingMessage,
    subgraphStreams: {},
    values: {
      title: "",
      messages,
      artifacts: [],
    },
    isLoading,
    isThreadLoading: false,
    error: undefined,
    stop: vi.fn(),
    refresh: vi.fn(),
    submit: vi.fn(),
    threadId: "thread-1",
  };
}

function messageListTree(thread: BaseStream<AgentThreadState>) {
  return (
    <SubtasksProvider>
      <ThreadProviders thread={thread}>
        <MessageList threadId="thread-1" thread={thread} paddingBottom={0} />
      </ThreadProviders>
    </SubtasksProvider>
  );
}

function trackedItemProps(id: string) {
  return renderTracker.itemRender.mock.calls
    .map(([props]) => props as Record<string, unknown> & { message: Message })
    .filter(({ message }) => message.id === id);
}

function parsedAssistantIds() {
  return renderTracker.extractText.mock.calls
    .map(([id]) => String(id))
    .filter((id) => id.startsWith("assistant-"));
}

describe("MessageList streaming render isolation", () => {
  test("indexes rows without indexOf and only builds shadow review for the actionable tail", () => {
    const firstHuman = {
      id: "human-1",
      type: "human",
      content: "first request",
    } as Message;
    const historicalAssistant = {
      id: "assistant-history",
      type: "ai",
      content: "settled historical answer",
      additional_kwargs: { message_kind: "answer" },
    } as Message;
    const latestHuman = {
      id: "human-2",
      type: "human",
      content: "second request",
    } as Message;
    const streamingAssistant = {
      id: "assistant-active",
      type: "ai",
      content: "partial",
      additional_kwargs: {
        message_kind: "answer",
        run_status: "streaming",
      },
    } as Message;
    const initialMessages = [
      firstHuman,
      historicalAssistant,
      latestHuman,
      streamingAssistant,
    ];
    const initialIndexOf = vi.spyOn(initialMessages, "indexOf");

    const view = renderWithProviders(
      messageListTree(mockThread(initialMessages, streamingAssistant, true)),
      {
        initialRoute: "/workspace/realtime/thread-1",
        locale: "en-US",
      },
    );

    expect(initialIndexOf).not.toHaveBeenCalled();
    expect(parsedAssistantIds()).toEqual([]);
    expect(trackedItemProps("assistant-history")).toHaveLength(1);
    expect(trackedItemProps("assistant-history")[0]).toMatchObject({
      messageIndex: 1,
      shadowReview: undefined,
    });

    renderTracker.extractText.mockClear();
    renderTracker.itemRender.mockClear();
    const nextStreamingAssistant = {
      ...streamingAssistant,
      content: "partial answer grows",
    } as Message;
    const nextMessages = [
      firstHuman,
      historicalAssistant,
      latestHuman,
      nextStreamingAssistant,
    ];
    const nextIndexOf = vi.spyOn(nextMessages, "indexOf");
    view.rerender(
      messageListTree(mockThread(nextMessages, nextStreamingAssistant, true)),
    );

    expect(nextIndexOf).not.toHaveBeenCalled();
    expect(parsedAssistantIds()).toEqual([]);
    expect(trackedItemProps("assistant-history")).toHaveLength(0);
    expect(trackedItemProps("assistant-active")).toHaveLength(1);

    renderTracker.extractText.mockClear();
    renderTracker.itemRender.mockClear();
    const settledAssistant = {
      ...nextStreamingAssistant,
      content: "complete answer",
      additional_kwargs: { message_kind: "answer", run_status: "completed" },
    } as Message;
    const settledMessages = [
      firstHuman,
      historicalAssistant,
      latestHuman,
      settledAssistant,
    ];
    const settledIndexOf = vi.spyOn(settledMessages, "indexOf");
    view.rerender(messageListTree(mockThread(settledMessages, null, false)));

    expect(settledIndexOf).not.toHaveBeenCalled();
    expect(parsedAssistantIds()).toEqual(["assistant-active"]);
    expect(trackedItemProps("assistant-history")).toHaveLength(0);
    expect(trackedItemProps("assistant-active")).toHaveLength(1);
    expect(trackedItemProps("assistant-active")[0]).toMatchObject({
      messageIndex: 3,
      shadowReview: {
        goal: "second request",
        messageId: "assistant-active",
        primaryEngine: "echo",
        primaryOutput: "complete answer",
        threadId: "thread-1",
      },
    });

    // Realtime projection can return a new messages array while preserving all
    // untouched Message references. That must not parse or render the settled
    // assistant again.
    renderTracker.extractText.mockClear();
    renderTracker.itemRender.mockClear();
    const identicalSnapshot = settledMessages.slice();
    const identicalIndexOf = vi.spyOn(identicalSnapshot, "indexOf");
    view.rerender(messageListTree(mockThread(identicalSnapshot, null, false)));

    expect(identicalIndexOf).not.toHaveBeenCalled();
    expect(parsedAssistantIds()).toEqual([]);
    expect(trackedItemProps("assistant-history")).toHaveLength(0);
    expect(trackedItemProps("assistant-active")).toHaveLength(0);
  });

  test("rebuilds a settled historical turn when its content is edited", () => {
    const history: Message[] = [];
    for (let turn = 0; turn < 20; turn += 1) {
      history.push({
        id: `human-${turn}`,
        type: "human",
        content: `request ${turn}`,
      } as Message);
      history.push({
        id: `assistant-${turn}`,
        type: "ai",
        content: `answer ${turn}`,
        additional_kwargs: { message_kind: "answer" },
      } as Message);
    }
    const streaming = (content: string) =>
      ({
        id: "assistant-streaming",
        type: "ai",
        content,
        additional_kwargs: { message_kind: "answer", run_status: "streaming" },
      }) as Message;

    const view = renderWithProviders(
      messageListTree(mockThread(history, streaming("a"), true)),
    );
    renderTracker.itemRender.mockClear();

    view.rerender(
      messageListTree(mockThread(history, streaming("b"), true)),
    );
    expect(trackedItemProps("assistant-18")).toHaveLength(0);

    const edited = history.map((message) =>
      message.id === "assistant-18"
        ? ({ ...message, content: "edited answer" } as Message)
        : message,
    );
    view.rerender(messageListTree(mockThread(edited, streaming("c"), true)));

    expect(trackedItemProps("assistant-18")).toHaveLength(1);
    expect(trackedItemProps("assistant-18")[0]?.message.content).toBe(
      "edited answer",
    );
  });
});
