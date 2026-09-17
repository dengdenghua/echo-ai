import { parseComposerDraft } from "./composer-capability-refs";

const PROJECT_INTENT_PATTERNS = [
  /(?:创建|新建|发起|启动|开启|开一个|开个|立项|规划)[^。！？，,;；]{0,30}?项目/u,
  /(?:start|create|launch|kick off|set up|plan|scope)[^.!?,;]{0,40}?\bproject\b/i,
] as const;

/**
 * Return a stable suggestion key when an ordinary draft looks like the start
 * of a durable project. We do not send this automatically: Project OS creates
 * reviewed milestones, budgets and team state, so confirmation stays explicit.
 */
export function detectProjectIntent(raw: string): string | null {
  const parsed = parseComposerDraft(raw);
  if (parsed.mode === "project") return null;

  const body = parsed.body.trim();
  if (!body) return null;

  const normalized = body.replace(/\s+/g, " ").slice(0, 400);
  return PROJECT_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))
    ? normalized
    : null;
}
