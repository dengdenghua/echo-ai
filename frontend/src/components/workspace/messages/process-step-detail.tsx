/**
 * A settled tool step opened in place from its row: the command it ran and
 * what came back. The conversation page has no trace view to send it to, so
 * a row whose evidence would be that trace expands here instead.
 */

const OUTPUT_KEYS = ["stdout", "stderr", "error", "output", "text", "content"];
const MAX_CHARS = 4_000;

/** Old CodeBuddy events used Python repr for an MCP text-block array. */
function legacyTextBlocks(text: string): string[] | null {
  if (!/^\[\s*\{\s*'type'\s*:\s*'text'/.test(text)) return null;
  const blocks: string[] = [];
  for (const match of text.matchAll(/'text'\s*:\s*'((?:[^'\\]|\\[\s\S])*)'/g)) {
    const raw = match[1] ?? "";
    // Decode string-literal escapes only; never evaluate Python expressions.
    const decoded = raw.replace(
      /\\(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
      (escape) => {
        if (/^\\[ux]/.test(escape))
          return String.fromCharCode(parseInt(escape.slice(2), 16));
        const chars: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          "\\": "\\",
          "'": "'",
          '"': '"',
        };
        return chars[escape[1] ?? ""] ?? escape;
      },
    );
    blocks.push(decoded);
  }
  return blocks.length ? blocks : null;
}

/** Readable output from a tool result, however deeply the engine wrapped it:
 *  Codex returns ``[{"text": "<json of the Echo tool result>"}]``. */
export function readableToolOutput(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (/^[[{"]/.test(text)) {
      try {
        return readableToolOutput(JSON.parse(text), depth + 1);
      } catch {
        const legacy = legacyTextBlocks(text);
        if (legacy) return readableToolOutput(legacy, depth + 1);
        // Tool arguments arrive before their closing quote/object. Decode
        // only a known JSON string field, never escapes in ordinary logs or
        // Windows paths. Keep an unfinished escape buffered until complete.
        const field =
          /^\s*\{[\s\S]*?"(?:content|code|text|patch|stdout|output)"\s*:\s*"((?:[^"\\]|\\[\s\S])*)(?:"|\\?$)/.exec(
            text,
          );
        if (field) {
          let fragment = field[1] ?? "";
          fragment = fragment.replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "");
          try {
            return JSON.parse(`"${fragment}"`);
          } catch {
            /* Wait for the next complete fragment. */
          }
        }
        return text;
      }
    }
    return text;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => readableToolOutput(part, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value !== "object") return String(value);
  const record = Object.fromEntries(Object.entries(value));
  return OUTPUT_KEYS.map((key) => readableToolOutput(record[key], depth + 1))
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
  const output =
    readableToolOutput(args.output) || readableToolOutput(step.result);
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
      className="ml-4 mt-1 min-w-0 max-w-full max-h-72 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-r-md border-l-2 border-border/50 bg-muted/20 px-3 py-2 font-mono text-[13px] leading-6 text-foreground/85 [tab-size:4]"
    >
      {text}
    </pre>
  );
}
