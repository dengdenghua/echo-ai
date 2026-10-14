/**
 * 「助手」 is one persistent conversation per account.
 *
 * Every entry point links to the alias ``/workspace/realtime/echo-assistant``.
 * The first build used that id for the conversation itself, so on an instance
 * with several accounts the first one to write owned it and everyone else got
 * "连接恢复失败". The alias now resolves to the account's own thread; an
 * account that can already read the original ``echo-assistant`` thread keeps
 * it, so earlier assistant history stays where it was.
 */
export const ASSISTANT_ALIAS_ID = "echo-assistant";

/** True for the alias and for any account's own assistant thread. */
export function isAssistantThreadId(threadId?: string | null): boolean {
  return (
    threadId === ASSISTANT_ALIAS_ID ||
    Boolean(threadId?.startsWith(`${ASSISTANT_ALIAS_ID}-`))
  );
}

/** A stable, short id per account that does not spell out the account. */
export function personalAssistantThreadId(actorId: string): string {
  // FNV-1a (32-bit) twice with different seeds: 64 bits, base36.
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < actorId.length; i++) {
      h ^= actorId.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36).padStart(7, "0");
  };
  return `${ASSISTANT_ALIAS_ID}-${hash(0x811c9dc5)}${hash(0x2b8f3a61)}`;
}
