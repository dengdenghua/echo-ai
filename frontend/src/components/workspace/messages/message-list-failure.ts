/**
 * Why a turn failed: the structured failure a turn carries and the kind of failure it is, for the message list's failure card.
 */
import { type Message } from "@/core/api/types";
import { isObjectLike } from "@/core/utils/guards";

import { type FailurePresentation } from "./message-output-summary";

export type StructuredFailure = {
  code?: string;
  detail: string;
  eventId?: string;
  /** Backend turn disposition: "failed" | "blocked_on_user" (see react_terminal). */
  disposition?: string;
  /** Backend failure classification kind: "environment" | "git_hook" | "". */
  failure_kind?: string;
  /** ``execution_unavailable``: the engine that could not start, and why. */
  engine?: string;
  reason?: string;
};

export function asFailureRecord(
  value: unknown,
): Record<string, unknown> | null {
  return isObjectLike(value) ? value : null;
}

export function structuredFailureFromMessages(
  messages: Message[],
): StructuredFailure | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "ai") continue;
    const error = asFailureRecord(message.additional_kwargs?.error);
    if (!error) continue;
    const info = asFailureRecord(error.info);
    const detail =
      typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : "turn failed";
    const disposition =
      typeof info?.disposition === "string" && info.disposition.trim()
        ? info.disposition.trim()
        : "";
    const failureKind =
      typeof info?.failure_kind === "string" && info.failure_kind.trim()
        ? info.failure_kind.trim()
        : "";
    const engine = typeof info?.engine === "string" ? info.engine.trim() : "";
    const reason = typeof info?.reason === "string" ? info.reason.trim() : "";
    return {
      detail,
      eventId: message.id,
      ...(typeof info?.code === "string" && info.code.trim()
        ? { code: info.code.trim() }
        : {}),
      ...(disposition ? { disposition } : {}),
      ...(failureKind ? { failure_kind: failureKind } : {}),
      ...(engine ? { engine } : {}),
      ...(reason ? { reason } : {}),
    };
  }
  return null;
}

export function latestTurnMessages(messages: Message[]): Message[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === "human") return messages.slice(index);
  }
  return messages;
}

export function failureKind(
  detail: string,
  code?: string,
  disposition?: string,
  failureKindHint?: string,
): FailurePresentation["kind"] {
  const signal = `${code ?? ""}\n${detail}`;
  const normalized = signal.toLowerCase();
  // A genuine "needs your input" hand-off is never a failure — amber/waiting.
  if (disposition === "blocked_on_user") {
    return "blocked";
  }
  // Backend environment classification wins over the heuristic below so the
  // frontend never re-labels a structured environment block as a network loss.
  if (failureKindHint === "environment") {
    return "environment";
  }
  if (failureKindHint === "auth" || failureKindHint === "authentication") {
    return "auth";
  }
  if (failureKindHint === "rate_limit" || failureKindHint === "rate-limit") {
    return "rate-limit";
  }
  if (
    failureKindHint === "backpressure" ||
    /codex_event_backpressure|notification queue is full/i.test(signal)
  ) {
    return "backpressure";
  }
  if (
    failureKindHint === "capability" ||
    failureKindHint === "missing_required_capability"
  ) {
    return "capability";
  }
  const isClientClose =
    /client closed/.test(normalized) ||
    /websocket closed \(1000/.test(normalized);
  const isAbort =
    /aborterror/.test(normalized) || /^abort$/i.test(detail.trim());
  if (isClientClose || isAbort) {
    return "error";
  }
  if (
    /react_structural_event_(?:delivery|apply)_failed|tool_start durable audit failed|tool execution blocked because its start event was not durably applied/i.test(
      signal,
    )
  ) {
    return "lifecycle";
  }
  if (
    /missing_required_capability|lacks required capabilit|capability mismatch|能力不匹配|缺少所需能力/i.test(
      signal,
    )
  ) {
    return "capability";
  }
  if (
    /http_401|http_403|unauthorized|invalid api.?key|invalid credential|credential refresh|credentials?.*(?:expired|invalid)|(?:not|未).*logged in.*chatgpt|尚未登录\s*chatgpt|登录.*chatgpt/i.test(
      signal,
    )
  ) {
    return "auth";
  }
  if (
    /http_429|rate.?limit|too many requests|quota exceeded|usage limit|请求过多|限流|额度.*(?:用完|耗尽|上限)/i.test(
      signal,
    )
  ) {
    return "rate-limit";
  }
  if (
    /network error|fetch failed|econnrefused|timeout|websocket closed \(1006|transport error|connection (refused|reset|lost)|model_stream_disconnected|unexpected_eof_while_reading|ssl eof|remoteprotocolerror|server disconnected/i.test(
      signal,
    )
  ) {
    return "network";
  }
  if (
    /verification_failed|verification failed|auto(?:matic)? verification (?:failed|timed out)/i.test(
      signal,
    )
  ) {
    return "verification-failed";
  }
  if (
    /verification_required|verification required|no verification step|Code changes were produced/i.test(
      signal,
    )
  ) {
    return "verification";
  }
  if (/guard_impasse|todo-protocol guard|completeness guard/i.test(signal)) {
    return "guard";
  }
  if (
    /missing_terminal_state|unknown_turn_status|runtime returned without a terminal/i.test(
      signal,
    )
  ) {
    return "lifecycle";
  }
  // Unstructured / legacy environment blocks (codes or raw stderr).
  if (
    /pnpm.*no.?tty|aborted removal of modules|permission denied|eacces|command not found|not found:|sandbox.*(?:blocked|denied)/i.test(
      signal,
    )
  ) {
    return "environment";
  }
  return "error";
}

/**
 * Memoized wrapper around a single message group. Only the group that
 * contains the currently-streaming message (or the latest group while
 * loading) will re-render on every token chunk; all completed groups
 * are frozen by React.memo and skip reconciliation entirely.
 */
