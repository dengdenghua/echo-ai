/**
 * Narrowing for JSON bodies that the OpenAPI snapshot only declares as a
 * plain ``dict`` / ``list[dict]``. The typed request layer surfaces those as
 * ``unknown`` / ``unknown[]`` (see ``Tighten`` in ``./request``); a module
 * narrows them here with a guard over the fields its callers rely on,
 * instead of a bare ``as`` at every call site.
 *
 * ``looseBody`` fails open on purpose: a body that does not pass its guard
 * is handed back unchanged, exactly as the cast it replaces did, so a shape
 * drift degrades the way it always has instead of becoming a new error
 * path. Every ``looseBody`` call therefore also marks a route that still
 * needs a FastAPI ``response_model``; once the snapshot types the route,
 * delete the call and let ``apiGet``/``apiPost`` carry the type.
 */
import type { Guard } from "@/core/utils/guards";

export type { Guard } from "@/core/utils/guards";

/** ``body`` as ``T``, checked by ``guard`` but passed through on a miss. */
export function looseBody<T>(body: unknown, guard: Guard<T>): T {
  if (guard(body)) return body;
  // The one trust point for loosely-declared bodies (see the module doc):
  // keep the pre-guard pass-through rather than throw or substitute.
  return body as T;
}
