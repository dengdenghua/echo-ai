export const FOLLOWUP_EVENT = "echo:queue-followup";
export const STEER_RECEIPT_EVENT = "echo:steer-receipt";
export const PAUSE_FOLLOWUPS_EVENT = "echo:pause-followups";
export const SIDE_QUESTION_EVENT = "echo:side-question";

export function queueFollowup(
  threadId: string | undefined,
  text: string,
): boolean {
  if (!threadId || !text.trim()) return false;
  const request = { threadId, text, accepted: false };
  window.dispatchEvent(new CustomEvent(FOLLOWUP_EVENT, { detail: request }));
  return request.accepted;
}

export function quoteIntoTask(threadId: string | undefined, text: string) {
  if (!threadId) return;
  window.dispatchEvent(
    new CustomEvent("echo:quote-message", { detail: { threadId, text } }),
  );
}
