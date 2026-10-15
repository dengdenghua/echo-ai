/**
 * A settled tool step opened in place from its row: the command it ran and
 * what came back. The conversation page has no trace view to send it to, so
 * a row whose evidence would be that trace expands here instead.
 */

const OUTPUT_KEYS = ["stdout", "stderr", "error", "output", "text", "content"];
const MAX_CHARS = 4_000;

/** Readable output from a tool result, however deeply the engine wrapped it:
 *  Codex returns ``[{"text": "<json of the Echo tool result>"}]``. */
function outputText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (/^[[{]/.test(text)) {
      try {
        return outputText(JSON.parse(text), depth + 1);
      } catch {
        return text;
      }
    }
    return text;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => outputText(part, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value !== "object") return String(value);
  const record = Object.fromEntries(Object.entries(value));
  return OUTPUT_KEYS.map((key) => outputText(record[key], depth + 1))
    .filter(Boolean)
    .join("\n");
}

/** ``$ command`` and its output, or ``null`` when the step carries neither. */
export function stepDetailText(step: {
  args?: Record<string, unknown>;
  result?: unknown;
}): string | null {
  const args = step.args ?? {};
  const command = [args.command, args.cmd].find(
    (value): value is string => typeof value === "string" && !!value.trim(),
  );
  const output = outputText(args.output) || outputText(step.result);
  const text = [command ? `$ ${command.trim()}` : "", output]
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
}

export function ProcessStepDetail({ text }: { text: string }) {
  return (
    <pre
      data-testid="process-step-detail"
      className="ml-4 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-border/50 py-1.5 pl-3 font-mono text-xs leading-5 text-muted-foreground"
    >
      {text}
    </pre>
  );
}
