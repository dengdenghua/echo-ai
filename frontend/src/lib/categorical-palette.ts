/**
 * The ECHO categorical ramp (`--cat-1` … `--cat-6` in globals.css): one
 * restrained palette for data that has no other channel, such as
 * knowledge-graph entity types, collaborator cursors or a colour the user
 * picked for a group. Chrome never uses it; modules and kinds are told apart
 * by icon and label.
 */
const SLOTS = [1, 2, 3, 4, 5, 6] as const;

export const CATEGORICAL_SLOTS = SLOTS.length;

export type CategoricalSlot = (typeof SLOTS)[number];

/** Snow values, used when no element is available to read the theme from. */
const SNOW_RAMP = [
  "#147684",
  "#4e699a",
  "#8f536b",
  "#686097",
  "#6d7279",
  "#1d4e60",
] as const;

function hashKey(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A stable slot for a key, so a category keeps its colour across renders. */
export function categoricalSlot(key: string): CategoricalSlot {
  return SLOTS[hashKey(key) % SLOTS.length] ?? 1;
}

/**
 * A slot another party chose as a 0-based ramp index (the Design presence
 * endpoint sends `color_index`, so every viewer draws a collaborator alike),
 * or the stable slot for `key` when that index is missing.
 */
export function categoricalSlotAt(
  index: number | null | undefined,
  key: string,
): CategoricalSlot {
  if (typeof index !== "number" || !Number.isInteger(index)) {
    return categoricalSlot(key);
  }
  const n = SLOTS.length;
  return SLOTS[((index % n) + n) % n] ?? 1;
}

/**
 * A slot's Snow value: dark enough for white text in either theme. Use it
 * where a colour leaves this client (e.g. stored with an annotation author),
 * so every viewer draws the same readable swatch.
 */
export function categoricalSnowHex(slot: CategoricalSlot): string {
  return SNOW_RAMP[slot - 1] ?? SNOW_RAMP[0];
}

/** CSS value for a slot, for style props and SVG fills. */
export function categoricalVar(slot: CategoricalSlot): string {
  return `var(--cat-${slot})`;
}

/**
 * The ramp as hex strings for canvas and WebGL, read from the theme in force
 * at `element` (Graphite under `.dark`, Snow otherwise).
 */
export function resolveCategoricalRamp(
  element?: Element | null,
): readonly string[] {
  const target =
    element ?? (typeof document !== "undefined" ? document.body : null);
  if (!target || typeof getComputedStyle !== "function") return SNOW_RAMP;
  const style = getComputedStyle(target);
  return SNOW_RAMP.map(
    (fallback, index) =>
      style.getPropertyValue(`--cat-${index + 1}`).trim() || fallback,
  );
}
