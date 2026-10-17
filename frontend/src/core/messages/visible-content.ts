// Visible-text extraction for chat messages: inline reasoning split,
// internal tool/prompt protocol stripping, legacy diagnostic repair and the
// ``extractTextFromMessage`` / ``extractContentFromMessage`` readers.
// Re-exported from ``./utils``; import from there.

import type { Message } from "@/core/api/types";

export function extractTextFromMessage(message: Message) {
  if (typeof message.content === "string") {
    const content =
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim();
    return message.type === "ai" ? visibleAIContent(content) : content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) =>
        content.type === "text"
          ? message.type === "ai"
            ? visibleAIContent(content.text)
            : content.text.trim()
          : "",
      )
      .join("\n")
      .trim();
  }
  return "";
}

const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g;

export function splitInlineReasoning(content: string) {
  const reasoningParts: string[] = [];
  const cleaned = content
    .replace(THINK_TAG_RE, (_, reasoning: string) => {
      const normalized = reasoning.trim();
      if (normalized) {
        reasoningParts.push(normalized);
      }
      return "";
    })
    .trim();

  return {
    content: cleaned,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
  };
}

function splitInlineReasoningFromAIMessage(message: Message) {
  if (message.type !== "ai" || typeof message.content !== "string") {
    return null;
  }
  return splitInlineReasoning(message.content);
}

const INTERNAL_TOOL_FENCE_RE =
  /```(?:tool|tools?|tool_call|echo-tool)\b[\s\S]*?(?:```|$)/gi;
const JSON_COMMAND_TOOL_FENCE_RE =
  /(?:\*\*Task:[^\n]*\*\*\s*)?```json\s*\{\s*"command"\s*:\s*"(?:fs_writer|fs_writen|fs_written|write_file|write_text_file|edit_text_file|str_replace|apply_patch)"[\s\S]*?(?:```|$)/gi;
/** Tool-call protocol emitted as a ``json`` fence whose payload is an ARRAY of
 * ``{"tool": ..., "args": ...}`` entries (batched calls), or a single such
 * object. ``JSON_COMMAND_TOOL_FENCE_RE`` only covers ``{"command": <writer>}``,
 * so batched array payloads used to leak verbatim into the public narrative —
 * a model that narrates its plan as ```json [{"tool": "list_cwd"}, ...]``` had
 * the whole protocol block rendered as chat copy. */
const JSON_TOOL_ARRAY_FENCE_RE =
  /```(?:json|jsonc|json5)?\s*\n?\s*[[{][\s\S]*?"(?:tool|tool_name)"\s*:\s*"[^"]+"[\s\S]*?(?:```|$)/gi;
const BARE_INTERNAL_TOOL_PAYLOAD_RE =
  /^\s*(?:fs_writer|fs_writen|fs_written|write_file|write_text_file|edit_file|edit_text_file|str_replace|apply_patch|todo_write|todo_update|exec_shell|shell_command|run_command|web_search|fetch_url|web_fetch|read_file|read_text_file|glob_files|find_files|grep_text|list_cwd|search_capabilities|query_skill|browser_open|browser_get_content|artifact|present_files)\s*(?:\n|\()\s*[\s\S]*$/i;
const XML_TOOL_CALL_RE = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi;
const SEED_TOOL_CALL_RE =
  /<seed:tool_call\b[^>]*>[\s\S]*?(?:<\/seed:tool_call>|$)/gi;
const XML_TOOL_INVOCATION_RE =
  /<tool_invocation\b[^>]*(?:\/>|>[\s\S]*?(?:<\/tool_invocation>|$))/gi;
const XML_GENERIC_FUNCTION_CALL_RE =
  /<function(?:=[^>\s]+|\b[^>]*)>[\s\S]*?(?:<\/function>|$)/gi;
const XML_FUNCTION_CALL_RE =
  /<function=(?:fs_writer|fs_writen|fs_written|write_file|write_text_file|edit_text_file|str_replace|apply_patch|deep_research|web_search|search)>[\s\S]*?(?:<\/function>|$)/gi;
const INTERNAL_PROMPT_ENVELOPE_NAMES = [
  "original-user-request",
  "just-completed-evidence",
  "next-public-scope",
  "bounded-read-evidence",
] as const;
const INTERNAL_CONTROL_TAG_LINE_RE =
  /^\s*(?:<read_only>\s*<\/read_only>|<\/?read_only>)\s*$/i;
const INTERNAL_CONTROL_TAG_INLINE_RE =
  /<read_only>\s*<\/read_only>|<\/?read_only>/gi;
const INTERNAL_RENDERER_COMPONENT_TAG_INLINE_RE =
  /`?<\/?(?:TextBlock|ReasoningBlock|ToolCallBlock|ToolResultBlock|ThinkingBlock|ExecutionBlock)\b[^<>`]*>`?/g;
const REACT_ACTION_BLOCK_RE =
  /^\s*Action:\s*(?!(?:none|null|n\/a)\s*$).*?(?=\n\s*(?:Thought|Action|Observation|Final Answer):|\s*$)/gims;
const REACT_OBSERVATION_BLOCK_RE =
  /^\s*Observation:\s*[\s\S]*?(?=\n\s*(?:Thought|Action|Observation|Final Answer):|\s*$)/gim;
const SENSITIVE_ASSIGNMENT_RE =
  /\b(token|secret|api[_-]?key|password|authorization)\s*[:=]\s*([^\s,;]+)/gi;
const ROLE_NO_OUTPUT_PLACEHOLDER_RE =
  /^\s*\[[^\]\n]{1,80}\]\s*\((?:no output|no visible output|empty output)\)\s*$/i;
const NO_OUTPUT_PLACEHOLDER_RE =
  /^\s*\((?:no output|no visible output|empty output)\)\s*$/i;
const TEAM_ROLE_START_RE =
  /^\s*\[(?:planner|researcher|critic|arbiter|synthesizer|writer|reviewer|analyst|coder|designer|executor|tester)\]\s*starting\s*(?:[·•-]|\u00b7)\s*agent=[^\n]*\n*/i;
const TEAM_ROLE_PREFIX_RE =
  /^\s*\[(?:planner|researcher|critic|arbiter|synthesizer|writer|reviewer|analyst|coder|designer|executor|tester)\]\s*/i;
const NULLISH_PLACEHOLDER_RE = /^\s*(?:null|undefined|none|n\/a)\s*$/i;
const REPEATED_NULL_PLACEHOLDER_RE = /^\s*(?:null\s*)+$/i;

function stripLeakedTeamRoleNoise(content: string): string {
  return content
    .replace(TEAM_ROLE_START_RE, "")
    .replace(TEAM_ROLE_PREFIX_RE, "")
    .trim();
}

/**
 * Remove model-facing prompt envelopes that a provider echoed into public
 * assistant text. Process fenced code separately so documentation and code
 * examples remain literal. A dangling opening tag consumes the rest of that
 * non-code segment: truncated provider output must not expose half an internal
 * request or evidence packet while it is still streaming.
 */
function stripInternalPromptEnvelopes(content: string): string {
  const hadPromptEnvelope = new RegExp(
    `\\[(?:${INTERNAL_PROMPT_ENVELOPE_NAMES.join("|")})\\]`,
    "i",
  ).test(content);
  const cleanedContent = content
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((segment) => {
      if (segment.startsWith("```")) return segment;
      let cleaned = segment;
      for (const name of INTERNAL_PROMPT_ENVELOPE_NAMES) {
        const paired = new RegExp(
          `\\[${name}\\][\\s\\S]*?\\[\\/${name}\\]`,
          "gi",
        );
        const dangling = new RegExp(`\\[${name}\\][\\s\\S]*$`, "gi");
        const closing = new RegExp(`\\[\\/${name}\\]`, "gi");
        cleaned = cleaned
          .replace(paired, "")
          .replace(dangling, "")
          .replace(closing, "");
      }
      return cleaned.replace(
        /^\s*\[explicit-read-scope\][^\n]*(?:\n|$)/gim,
        "",
      );
    })
    .join("");
  // If removing an echoed packet leaves only a short provider label such as
  // "mock-echo:" or "Answer:", suppress the row entirely. Rendering that
  // shell creates an empty assistant bubble above the actual answer.
  if (
    hadPromptEnvelope &&
    /^[\p{L}\p{N}_ -]{0,40}[:：-]?\s*$/u.test(cleanedContent)
  ) {
    return "";
  }
  return cleanedContent;
}

export function stripLeakedRendererMarkup(
  content: string,
  options: { trim?: boolean } = {},
): string {
  let insideFence = false;
  const lines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      lines.push(line);
      continue;
    }
    if (!insideFence && INTERNAL_CONTROL_TAG_LINE_RE.test(line)) continue;
    lines.push(
      insideFence
        ? line
        : line
            .replace(INTERNAL_CONTROL_TAG_INLINE_RE, "")
            .replace(INTERNAL_RENDERER_COMPONENT_TAG_INLINE_RE, "")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\s+([，。！？；：,.!?;:])/g, "$1"),
    );
  }
  const stripped = lines.join("\n").replace(/^\n+/, "");
  return options.trim === false ? stripped : stripped.trim();
}

/**
 * Repair failure prose persisted before terminal diagnostics were separated
 * from model-facing guard feedback.  Keep this deliberately narrow: ordinary
 * discussions of guards (for example in a code review) must remain intact.
 */
export function sanitizeLegacyGuardDiagnostic(content: string): string {
  const text = content.trim();
  const guardMatch = text.match(
    /(?:「|\b)([a-z][a-z0-9-]*(?:[ -][a-z0-9-]+)* guard)(?:」|\b)/i,
  );
  const isFailureDiagnostic =
    /任务未(?:能|完成)|这轮任务没有完成|质量提示|未通过证据门禁|最后一次拦截原因/i.test(
      text,
    ) ||
    (/(?:系统|system).{0,120}(?:拦截|阻止|拒绝|blocked|rejected)/i.test(text) &&
      /(?:我.{0,80}(?:回复|最终答案|收尾)|my final answer)/i.test(text));
  const leakedCompletenessReason =
    /The proposed Final Answer (?:only announces|only promises|is empty)|Execute the stated (?:read|search)|not a completed answer/i.test(
      text,
    );
  if ((!guardMatch && !leakedCompletenessReason) || !isFailureDiagnostic) {
    return content;
  }

  const label = guardMatch?.[1]?.toLowerCase() ?? "";
  const reason =
    label.includes("final-answer completeness") || leakedCompletenessReason
      ? "收尾内容仍像进行中说明，尚未形成可交付结果。"
      : label.includes("todo-protocol")
        ? "任务清单状态与实际执行结果没有同步。"
        : label.includes("code-mode")
          ? "代码任务缺少可确认的修改或验证结果。"
          : "系统未能确认本轮已经形成可交付结果。";

  return [
    "这轮任务没有完成。我已停止重复尝试，并保留了当前进度。",
    `原因：${reason}`,
    "可以点击重试继续；如果仍失败，请补充必要的信息、权限或换一种执行方式。",
  ].join("\n\n");
}

const LEGACY_INTERNAL_AGENT_ERROR_RE =
  /^\s*(?:`{1,3})?\[(?:planner|runner|subagent) error\]/i;

/**
 * Old group-fanout turns persisted model-runner diagnostics as ordinary chat
 * text and sometimes marked the corresponding member lane completed. Keep the
 * immutable event log intact for audit, but never expose that internal parser
 * protocol in the conversation UI.
 */
export function isLegacyInternalAgentError(content: unknown): boolean {
  return (
    typeof content === "string" && LEGACY_INTERNAL_AGENT_ERROR_RE.test(content)
  );
}

export function sanitizeLegacyInternalAgentError(content: string): string {
  return isLegacyInternalAgentError(content)
    ? "该成员当时未能生成有效回复。"
    : content;
}

function stripReactProtocol(content: string): string {
  let cleaned = content
    .replace(REACT_ACTION_BLOCK_RE, "")
    .replace(REACT_OBSERVATION_BLOCK_RE, "")
    .trim();
  const finalAnswer = cleaned.match(/(?:^|\n)Final Answer:\s*([\s\S]*)$/i);
  if (finalAnswer?.[1]?.trim()) {
    cleaned = finalAnswer[1].trim();
  }
  // Context compaction can prompt a model to emit an internal continuation
  // hand-off. It is useful for recovery, but it is not a user-facing answer
  // and often contains paths, iteration counters, or protocol vocabulary.
  cleaned = cleaned
    .replace(
      /(^|[\n。！？.!?])\s*(?:\*\*|__)?\s*(?:resume\s+state|continuation\s+note|恢复状态|恢复摘要)\s*:\s*(?:\*\*|__)?\s*[\s\S]*?(?=\n\s*\n|$)/im,
      "$1",
    )
    .trim();
  return cleaned
    .replace(
      /^\s*Thought:\s*[\s\S]*?(?=\n\s*Final Answer:|\n\s*Action:|$)/gim,
      "",
    )
    .replace(/^\s*Final Answer:\s*/gim, "")
    .replace(SENSITIVE_ASSIGNMENT_RE, "$1=[redacted]")
    .trim();
}

export function stripInternalToolProtocol(content: string): string {
  const cleaned = stripInternalPromptEnvelopes(content)
    .replace(INTERNAL_TOOL_FENCE_RE, "")
    .replace(JSON_COMMAND_TOOL_FENCE_RE, "")
    .replace(JSON_TOOL_ARRAY_FENCE_RE, "")
    .replace(SEED_TOOL_CALL_RE, "")
    .replace(XML_TOOL_CALL_RE, "")
    .replace(XML_TOOL_INVOCATION_RE, "")
    .replace(XML_GENERIC_FUNCTION_CALL_RE, "")
    .replace(XML_FUNCTION_CALL_RE, "")
    .replace(BARE_INTERNAL_TOOL_PAYLOAD_RE, "")
    .trim();
  const reactCleaned = stripReactProtocol(cleaned);
  if (!reactCleaned.startsWith("{")) return reactCleaned;

  try {
    const payload: unknown = JSON.parse(reactCleaned);
    if (
      payload &&
      typeof payload === "object" &&
      "command" in payload &&
      typeof payload.command === "string" &&
      /^(?:fs_writer|fs_writen|fs_written|write_file|write_text_file|edit_text_file|str_replace|apply_patch)$/i.test(
        payload.command,
      )
    ) {
      return "";
    }
  } catch {
    return reactCleaned;
  }

  return reactCleaned;
}

function visibleAIContent(content: string): string {
  const visible = stripLeakedTeamRoleNoise(
    stripLeakedRendererMarkup(stripInternalToolProtocol(content.trim())),
  );
  return ROLE_NO_OUTPUT_PLACEHOLDER_RE.test(visible) ||
    NO_OUTPUT_PLACEHOLDER_RE.test(visible) ||
    NULLISH_PLACEHOLDER_RE.test(visible) ||
    REPEATED_NULL_PLACEHOLDER_RE.test(visible)
    ? ""
    : visible;
}

export function extractContentFromMessage(message: Message) {
  if (typeof message.content === "string") {
    const content =
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim();
    return message.type === "ai" ? visibleAIContent(content) : content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => {
        switch (content.type) {
          case "text":
            return message.type === "ai"
              ? visibleAIContent(content.text)
              : content.text.trim();
          case "image_url":
            const imageURL = extractURLFromImageURLContent(content.image_url);
            return `![image](${imageURL})`;
          // Extended-thinking blocks ("我将先检查…" style outward-facing
          // narration) render as normal body text when the grouping layer
          // decides they are user-facing, not collapsible inner thought.
          case "thinking": {
            const thinking =
              typeof content.thinking === "string"
                ? content.thinking
                : typeof content.text === "string"
                  ? content.text
                  : "";
            return thinking.trim();
          }
          default:
            return "";
        }
      })
      .join("\n")
      .trim();
  }
  return "";
}

export function extractURLFromImageURLContent(
  content:
    | string
    | {
        url: string;
      },
) {
  if (typeof content === "string") {
    return content;
  }
  return content.url;
}
