import type { ExecutionEngine } from "./execution-policy";

export const DEFAULT_MODEL_ROUTE_EVENT = "echo:default-model-route-changed";

export function readDefaultModelRoute(
  principal: string,
  model: string,
): ExecutionEngine | null {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(`echo:default-model-route:${principal}`) || "null",
    );
    if (typeof saved !== "object" || saved === null) return null;
    const engine = Reflect.get(saved, "engine");
    return Reflect.get(saved, "model") === model &&
      ["echo", "codex", "opencode", "codebuddy"].includes(engine)
      ? engine
      : null;
  } catch {
    return null;
  }
}

export function rememberDefaultModelRoute(
  principal: string,
  model: string,
  engine: ExecutionEngine,
) {
  try {
    localStorage.setItem(
      `echo:default-model-route:${principal}`,
      JSON.stringify({ model, engine }),
    );
    localStorage.setItem(`echo:execution-engine-last:${principal}`, engine);
  } catch {
    /* Optional browser storage. */
  }
  window.dispatchEvent(
    new CustomEvent(DEFAULT_MODEL_ROUTE_EVENT, {
      detail: { principal, engine },
    }),
  );
}
