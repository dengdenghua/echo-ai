/** Tab-scoped reading preferences. Store identifiers/geometry, never prose. */
const KEY = "echo:conversation-view:v1";
export interface ConversationReadingPosition {
  top: number;
  atBottom: boolean;
  turnId?: string;
  groupId?: string;
  blockIndex?: number;
  offset?: number;
}
interface ViewState {
  process?: Record<string, boolean>;
  scroll?: ConversationReadingPosition;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(
  value: unknown,
): ConversationReadingPosition | undefined {
  if (
    !isRecord(value) ||
    typeof value.top !== "number" ||
    !Number.isFinite(value.top) ||
    value.top < 0 ||
    typeof value.atBottom !== "boolean"
  )
    return;
  return {
    top: value.top,
    atBottom: value.atBottom,
    turnId: typeof value.turnId === "string" ? value.turnId : undefined,
    groupId: typeof value.groupId === "string" ? value.groupId : undefined,
    offset:
      typeof value.offset === "number" && Number.isFinite(value.offset)
        ? value.offset
        : undefined,
    blockIndex:
      typeof value.blockIndex === "number" &&
      Number.isInteger(value.blockIndex) &&
      value.blockIndex >= 0
        ? value.blockIndex
        : undefined,
  };
}

function readAll(): Record<string, ViewState> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (!isRecord(parsed)) return {};
    const result: Record<string, ViewState> = {};
    for (const [id, value] of Object.entries(parsed).slice(-32)) {
      if (!isRecord(value)) continue;
      const process: Record<string, boolean> = {};
      if (isRecord(value.process)) {
        for (const [key, choice] of Object.entries(value.process).slice(-100)) {
          if (typeof choice === "boolean") process[key] = choice;
        }
      }
      result[id] = { process, scroll: parsePosition(value.scroll) };
    }
    return result;
  } catch {
    return {};
  }
}

function update(threadId: string, patch: (state: ViewState) => ViewState) {
  if (!threadId) return;
  try {
    const all = readAll();
    const previous = all[threadId] ?? {};
    delete all[threadId];
    all[threadId] = patch(previous);
    sessionStorage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(Object.entries(all).slice(-32))),
    );
  } catch {
    /* Storage can be unavailable; reading must still work. */
  }
}

export function readProcessChoice(
  threadId: string,
  groupId: string,
): boolean | null {
  const value = readAll()[threadId]?.process?.[groupId];
  return typeof value === "boolean" ? value : null;
}

export function saveProcessChoice(
  threadId: string,
  groupId: string,
  choice: boolean | null,
) {
  if (!groupId) return;
  update(threadId, (state) => {
    const process = { ...state.process };
    delete process[groupId];
    if (choice !== null) process[groupId] = choice;
    return {
      ...state,
      process: Object.fromEntries(Object.entries(process).slice(-100)),
    };
  });
}

export function readReadingPosition(
  threadId: string,
): ConversationReadingPosition | null {
  return readAll()[threadId]?.scroll ?? null;
}

export function saveReadingPosition(
  threadId: string,
  scroll: ConversationReadingPosition,
) {
  update(threadId, (state) => ({ ...state, scroll }));
}

export const READING_BLOCKS =
  'p,h1,h2,h3,h4,pre,table,[data-testid="process-replay-toggle"]';

export function captureReadingPosition(
  root: HTMLElement,
): ConversationReadingPosition {
  const viewport = root.getBoundingClientRect();
  const groups = Array.from(
    root.querySelectorAll<HTMLElement>("[data-message-group]"),
  );
  const group = groups.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  const blocks = group
    ? Array.from(group.querySelectorAll<HTMLElement>(READING_BLOCKS))
    : [];
  const block = blocks.find(
    (node) => node.getBoundingClientRect().bottom > viewport.top,
  );
  const anchor = block ?? group;
  return {
    top: root.scrollTop,
    atBottom: root.scrollHeight - root.clientHeight - root.scrollTop < 24,
    turnId: group?.closest<HTMLElement>("[data-message-turn]")?.dataset
      .messageTurn,
    groupId: group?.dataset.messageGroup,
    blockIndex: block ? blocks.indexOf(block) : undefined,
    offset: anchor
      ? anchor.getBoundingClientRect().top - viewport.top
      : undefined,
  };
}

export function restoreReadingPosition(
  root: HTMLElement,
  position: ConversationReadingPosition,
): boolean {
  const group = Array.from(
    root.querySelectorAll<HTMLElement>("[data-message-group]"),
  ).find((node) => node.dataset.messageGroup === position.groupId);
  if (group) {
    const block =
      position.blockIndex === undefined
        ? group
        : group.querySelectorAll<HTMLElement>(READING_BLOCKS)[
            position.blockIndex
          ];
    if (block) {
      root.scrollTop +=
        block.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        (position.offset ?? 0);
      return true;
    }
  }
  const turn = Array.from(
    root.querySelectorAll<HTMLElement>("[data-message-turn]"),
  ).find((node) => node.dataset.messageTurn === position.turnId);
  if (turn)
    root.scrollTop +=
      turn.getBoundingClientRect().top - root.getBoundingClientRect().top;
  else root.scrollTop = position.top;
  return false;
}
