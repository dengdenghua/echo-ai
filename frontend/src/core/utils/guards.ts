/**
 * Runtime type guards for narrowing ``unknown`` values — JSON bodies,
 * storage reads, ``postMessage`` and stream payloads — without type
 * assertions. Prefer these (or a module guard built from them) over
 * ``value as T``.
 */

/** A type guard, e.g. ``isRecord`` or a module's ``isTeam``. */
export type Guard<T> = (value: unknown) => value is T;

/** A non-null, non-array object — what ``JSON.parse`` gives for ``{}``. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Any non-null object, arrays included, for reading fields loosely
 * (``typeof value === "object"`` checks that let arrays through).
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** ``value`` when it is object-like (see ``isObjectLike``), else ``undefined``. */
export function objectLike(
  value: unknown,
): Record<string, unknown> | undefined {
  return isObjectLike(value) ? value : undefined;
}

/** ``Array.isArray`` narrows ``unknown`` to ``any[]``; this keeps ``unknown``. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** An array whose every item passes ``guard``. */
export function isArrayOf<T>(value: unknown, guard: Guard<T>): value is T[] {
  return Array.isArray(value) && value.every((item) => guard(item));
}

/** Guard for ``T[]`` built from an item guard. */
export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => isArrayOf(value, guard);
}

export function isStringArray(value: unknown): value is string[] {
  return isArrayOf(value, isString);
}

/** ``value`` is one of ``options`` (e.g. a string-literal union). */
export function isOneOf<const T extends readonly unknown[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return options.includes(value);
}

/**
 * ``source[key]`` when it is a string. For dynamic keys into typed tables
 * (e.g. a translation namespace) that have no index signature.
 */
export function stringAt(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === "string" ? value : undefined;
}
