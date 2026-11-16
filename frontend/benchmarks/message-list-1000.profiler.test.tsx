import { Profiler, type ProfilerOnRenderCallback } from "react";
import { describe, expect, test } from "vitest";

import type { Message } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";
import type { AgentThreadState } from "@/core/threads";
import { SubtasksProvider } from "@/core/tasks/context";
import { ArtifactsProvider } from "@/components/workspace/artifacts/context";
import { MessageList } from "@/components/workspace/messages/message-list";
import { ThreadProviders } from "@/components/workspace/messages/context";
import { SidebarProvider } from "@/components/ui/sidebar";
import { renderWithProviders } from "@/test/harness";

const TURNS = Number(process.env.PROFILER_TURNS ?? 500);
const TOKEN_UPDATES = Number(process.env.PROFILER_UPDATES ?? 10);

interface Commit {
  phase: string;
  actualDuration: number;
  baseDuration: number;
}

function settledMessages(): Message[] {
  const messages: Message[] = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    messages.push({
      id: `human-${turn}`,
      type: "human",
      content: `request ${turn}`,
    } as Message);
    messages.push({
      id: `assistant-${turn}`,
      type: "ai",
      content: `settled answer ${turn}`,
      additional_kwargs: { message_kind: "answer" },
    } as Message);
  }
  return messages;
}

function threadWith(
  messages: Message[],
  streamingMessage: Message | null,
): BaseStream<AgentThreadState> {
  return {
    messages,
    streamingMessage,
    subgraphStreams: {},
    values: { title: "", messages, artifacts: [] },
    isLoading: streamingMessage !== null,
    isThreadLoading: false,
    error: undefined,
    stop: () => {},
    refresh: () => {},
    submit: () => {},
    threadId: "thread-profiler",
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

describe("MessageList 1,000-message profiler", () => {
  test("records mount and streaming-token commit durations", () => {
    const messages = settledMessages();
    const commits: Commit[] = [];
    const onRender: ProfilerOnRenderCallback = (
      _id,
      phase,
      actualDuration,
      baseDuration,
    ) => {
      commits.push({ phase, actualDuration, baseDuration });
    };
    const tree = (streamingMessage: Message | null) => {
      const thread = threadWith(messages, streamingMessage);
      return (
        <SidebarProvider>
          <ArtifactsProvider threadId="thread-profiler">
            <SubtasksProvider>
              <ThreadProviders thread={thread}>
                <Profiler id="message-list" onRender={onRender}>
                  <MessageList
                    threadId="thread-profiler"
                    thread={thread}
                    paddingBottom={0}
                  />
                </Profiler>
              </ThreadProviders>
            </SubtasksProvider>
          </ArtifactsProvider>
        </SidebarProvider>
      );
    };

    const startedAt = performance.now();
    const rendered = renderWithProviders(tree(null));
    const mountWallMs = performance.now() - startedAt;
    const mountCommits = commits.filter((commit) => commit.phase === "mount");

    const updateWall: number[] = [];
    for (let index = 0; index < TOKEN_UPDATES; index += 1) {
      const updateStartedAt = performance.now();
      rendered.rerender(
        tree({
          id: "streaming-answer",
          type: "ai",
          content: `token ${index}`,
          additional_kwargs: { message_kind: "answer", run_status: "streaming" },
        } as Message),
      );
      updateWall.push(performance.now() - updateStartedAt);
    }

    const updateCommits = commits.filter((commit) => commit.phase === "update");
    const report = {
      turns: TURNS,
      messages: messages.length,
      tokenUpdates: TOKEN_UPDATES,
      domNodes: document.querySelectorAll("*").length,
      mountWallMs,
      mountCommits: mountCommits.length,
      mountActualDurationMs: mountCommits.reduce(
        (sum, commit) => sum + commit.actualDuration,
        0,
      ),
      updateCommits: updateCommits.length,
      updateActualMedianMs: median(
        updateCommits.map((commit) => commit.actualDuration),
      ),
      updateActualMaxMs: Math.max(
        ...updateCommits.map((commit) => commit.actualDuration),
      ),
      updateWallMedianMs: median(updateWall),
      updateWallMaxMs: Math.max(...updateWall),
    };
    console.log(`[message-list-profiler] ${JSON.stringify(report)}`);

    expect(mountCommits.length).toBeGreaterThan(0);
    expect(updateCommits.length).toBeGreaterThan(0);
    expect(report.domNodes).toBeGreaterThan(100);
  });
});
