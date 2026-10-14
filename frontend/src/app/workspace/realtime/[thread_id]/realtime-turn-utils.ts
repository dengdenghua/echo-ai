import { isAIMessage, isHumanMessage, type Message } from "@/core/api/types";
import { compactDesignResultText } from "@/core/design/mode-bridge";
import {
  extractTextFromMessage,
  isSettledAssistantAnswer,
  type FileInMessage,
  parseUploadedFiles,
  stripUploadedFilesTag,
} from "@/core/messages/utils";
import {
  extractCodeBlocks,
  hasPreviewableBlocks,
} from "@/lib/extract-code-blocks";

/** Pure projections of the live message list used by the realtime page. */

export function latestTurnPreviewBlocks(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    // Current turn only: an inline-preview block from an earlier turn
    // must not hijack every later completion (same scoping as
    // resultPreviewUrl below).
    if (msg && isHumanMessage(msg)) break;
    if (!msg || !isAIMessage(msg)) continue;
    const text =
      typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter(
              (c): c is { type: "text"; text: string } => c.type === "text",
            )
            .map((c) => c.text)
            .join("\n");
    const blocks = extractCodeBlocks(text);
    if (hasPreviewableBlocks(blocks)) return blocks;
  }
  return null;
}

/** Messages after the last human message (the current turn). */
export function messagesSinceLastHuman(messages: Message[]): Message[] {
  let turnStart = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && isHumanMessage(message)) {
      turnStart = i + 1;
      break;
    }
  }
  return messages.slice(turnStart);
}

export interface ConversationUserInput {
  text: string;
  uploadedFiles: Array<{ filename: string; path: string }>;
  attachments: Array<{ filename: string }>;
}

export function collectConversationUserInput(
  messages: Message[],
): ConversationUserInput | null {
  // 概要页「上下文」统计需要覆盖整段对话喂入的上下文文件，而不只是最后一轮：
  // 文件通常在对话开头喂入，后续轮次只发文字追问。因此跨所有 human 消息聚合
  // 上传文件与附件（按文件名去重），文本仍取最后一条 human 消息。
  const humanMessages = messages.filter(isHumanMessage);
  if (humanMessages.length === 0) return null;

  const last = humanMessages[humanMessages.length - 1]!;
  const rawOf = (m: (typeof humanMessages)[number]) =>
    typeof m.content === "string"
      ? m.content
      : m.content
          .filter(
            (c): c is { type: "text"; text: string } => c.type === "text",
          )
          .map((c) => c.text)
          .join("\n");
  const text = stripUploadedFilesTag(rawOf(last));

  const seenFilenames = new Set<string>();
  const uploaded: Array<{ filename: string; path: string }> = [];
  const attachments: Array<{ filename: string }> = [];
  for (const human of humanMessages) {
    const raw = rawOf(human);
    // Files ride the structured metadata channel (additional_kwargs.files) as
    // the primary source; the <uploaded_files> content tag is only a backward
    // compat fallback. Merge both, de-duplicated by filename.
    const structuredFiles = (
      Array.isArray(human.additional_kwargs?.files)
        ? (human.additional_kwargs.files as FileInMessage[])
        : []
    )
      .map((f) => ({ filename: f.filename, path: f.path ?? "" }))
      .filter((f) => f.filename);
    const contentFiles = parseUploadedFiles(raw)
      .filter((f): f is typeof f & { path: string } => Boolean(f.path))
      .map((f) => ({
        filename: f.filename,
        path: f.path,
      }));
    for (const f of [...structuredFiles, ...contentFiles]) {
      if (seenFilenames.has(f.filename)) continue;
      seenFilenames.add(f.filename);
      uploaded.push(f);
    }
    const rawAttachments = Array.isArray(human.additional_kwargs?.attachments)
      ? (human.additional_kwargs.attachments as Array<{ filename?: string }>)
      : [];
    for (const a of rawAttachments) {
      if (!a.filename || seenFilenames.has(a.filename)) continue;
      seenFilenames.add(a.filename);
      attachments.push({ filename: a.filename });
    }
  }
  if (!text && uploaded.length === 0 && attachments.length === 0) return null;
  return { text, uploadedFiles: uploaded, attachments };
}

/** The newest settled answer of the turn, compacted for the Design Canvas. */
export function latestSettledDesignAnswer(lastTurnMessages: Message[]) {
  for (let index = lastTurnMessages.length - 1; index >= 0; index -= 1) {
    const message = lastTurnMessages[index];
    if (
      !message ||
      !isSettledAssistantAnswer(message, { allowToolCalls: true })
    ) {
      continue;
    }
    const text = compactDesignResultText(extractTextFromMessage(message));
    if (!text) continue;
    return {
      messageId: message.id || `answer-${index}`,
      text,
    };
  }
  return null;
}
