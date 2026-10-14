import type { AutomationTarget } from "@/core/computer/api";
import { parseFileReference } from "@/core/navigation/file-reference";

export const OPEN_AUTOMATION_PREVIEW = "echo:open-automation-preview";
export const CLOSE_AUTOMATION_INSPECTION = "echo:close-automation-inspection";

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string" && value.length < 250_000) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function automationTargetFrom(value: unknown): AutomationTarget | null {
  const item = record(value);
  if (!item) return null;
  for (const raw of [item.target, item.automation_target, item]) {
    const target = record(raw);
    if (
      !target ||
      !["desktop_window", "browser_tab"].includes(String(target.kind))
    )
      continue;
    if (!target.id || typeof target.title !== "string" || !target.title.trim())
      continue;
    return {
      kind: target.kind as AutomationTarget["kind"],
      source: String(target.source || "computer"),
      id: String(target.id),
      title: target.title,
      ...Object.fromEntries(
        ["url", "app_id", "app_name", "icon_url"]
          .filter((key) => typeof target[key] === "string")
          .map((key) => [key, target[key]]),
      ),
    };
  }
  return null;
}

export type ToolResource =
  | { kind: "app"; target: AutomationTarget }
  | { kind: "web"; url: string; title: string }
  | { kind: "file"; path: string; lines?: string };

export function toolResources(
  input: unknown,
  output?: unknown,
): ToolResource[] {
  const refs: ToolResource[] = [];
  const seen = new Set<string>();
  const add = (key: string, resource: ToolResource) => {
    if (!seen.has(key) && refs.length < 5) {
      seen.add(key);
      refs.push(resource);
    }
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 2 || refs.length >= 5) return;
    const item = record(value);
    if (!item) return;
    const target = automationTargetFrom(item);
    if (target) add(`app:${target.kind}:${target.id}`, { kind: "app", target });
    const url = typeof item.url === "string" ? item.url : undefined;
    if (url && /^https?:\/\//i.test(url)) {
      try {
        const parsed = new URL(url);
        if (
          !parsed.username &&
          !parsed.password &&
          !/(token|secret|api.?key|password|signature)=/i.test(parsed.search)
        ) {
          add(`url:${url}`, {
            kind: "web",
            url,
            title:
              typeof item.title === "string" ? item.title : parsed.hostname,
          });
        }
      } catch {
        /* Ignore incomplete streaming URLs. */
      }
    }
    for (const key of [
      "path",
      "file_path",
      "filepath",
      "filename",
      "output_path",
    ]) {
      if (typeof item[key] !== "string") continue;
      const file = parseFileReference(item[key]);
      if (
        file &&
        !/(?:^|[\\/])(?:\.env(?:\.|$)|credentials|auth\.json|id_rsa|id_ed25519)/i.test(
          file.path,
        )
      )
        add(`file:${file.path}`, { kind: "file", ...file });
    }
    for (const key of [
      "target",
      "automation_target",
      "result",
      "data",
      "results",
      "files",
      "artifacts",
    ]) {
      const nested = item[key];
      if (Array.isArray(nested))
        nested.slice(0, 5).forEach((child) => visit(child, depth + 1));
      else if (nested) visit(nested, depth + 1);
    }
  };
  visit(output);
  visit(input);
  return refs;
}
