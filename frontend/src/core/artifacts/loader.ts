import { EchoAPIError, apiGet, untypedApi } from "@/core/api/request";
import { isAIMessage } from "@/core/api/types";
import type { BaseStream } from "@/core/api/use-stream-types";

import type { AgentThreadState } from "../threads";

import { urlOfArtifact } from "./utils";

export class ArtifactLoadError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ArtifactLoadError";
    this.status = status;
  }
}

export async function loadArtifactContent({
  filepath,
  threadId,
  isMock,
}: {
  filepath: string;
  threadId: string;
  isMock?: boolean;
}) {
  let enhancedFilepath = filepath;
  if (filepath.endsWith(".skill")) {
    enhancedFilepath = filepath + "/SKILL.md";
  }
  const url = urlOfArtifact({ filepath: enhancedFilepath, threadId, isMock });
  let response: Response;
  try {
    response = await untypedApi.fetch("get", url, {
      reason:
        "urlOfArtifact resolves the full URL (multi-segment artifact path, mock route)",
      baseUrl: "",
      errorMessage: (failure) => `artifact request failed (${failure.status})`,
    });
  } catch (error) {
    if (error instanceof EchoAPIError) {
      throw new ArtifactLoadError(error.status, error.message);
    }
    throw error;
  }
  return { content: await response.text(), url };
}

export function loadArtifactContentFromToolCall({
  url: urlString,
  thread,
}: {
  url: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const url = new URL(urlString);
  const toolCallId = url.searchParams.get("tool_call_id");
  const messageId = url.searchParams.get("message_id");
  if (messageId && toolCallId) {
    const message = thread.messages.find((message) => message.id === messageId);
    if (message && isAIMessage(message) && message.tool_calls) {
      const toolCall = message.tool_calls.find(
        (toolCall) => toolCall.id === toolCallId,
      );
      if (toolCall) {
        return toolCall.args.content as string | undefined;
      }
    }
  }
}

export function loadToolCallInfo({
  url: urlString,
  thread,
}: {
  url: string;
  thread: BaseStream<AgentThreadState>;
}) {
  const url = new URL(urlString);
  const toolCallId = url.searchParams.get("tool_call_id");
  const messageId = url.searchParams.get("message_id");
  if (messageId && toolCallId) {
    const message = thread.messages.find((message) => message.id === messageId);
    if (message && isAIMessage(message) && message.tool_calls) {
      const toolCall = message.tool_calls.find(
        (toolCall) => toolCall.id === toolCallId,
      );
      if (toolCall) {
        return {
          name: toolCall.name,
          path: toolCall.args.path as string | undefined,
          content: toolCall.args.content as string | undefined,
          oldStr: toolCall.args.old_str as string | undefined,
          newStr: toolCall.args.new_str as string | undefined,
        };
      }
    }
  }
  return null;
}

export async function loadOriginalFileContent(path: string, threadId?: string) {
  let data: { binary?: boolean; content: string };
  try {
    // ``binary`` is sent for non-text files but missing from FsReadResponse.
    data = await apiGet("/api/fs/read", {
      query: { path, max_lines: 5000, thread_id: threadId || undefined },
    });
  } catch (error) {
    // Any HTTP failure means "no original content".
    if (error instanceof EchoAPIError) return null;
    throw error;
  }
  if (data.binary) return null;
  return data.content;
}
