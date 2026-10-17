// ReAct trace splitter for the realtime adapter (``realtime-adapter.ts``).
// ``splitReactTrace`` is re-exported from ``./realtime-adapter``.

import { segmentLLMTrace, hasLLMTraceMarkers } from "@/core/i18n/llmMarkers";

/**
 * Split a ReAct-formatted LLM trajectory into the three semantic
 * pieces the UI needs separately:
 *
 *   - ``thought``:      everything inside ``Thought:`` blocks. Shown
 *                       as collapsible reasoning, not main content.
 *   - ``finalAnswer``:  body after the LAST ``Final Answer:`` marker.
 *                       Rendered as the agent's visible message.
 *
 * ``Action: tool(...)`` and ``Observation: ...`` lines are dropped:
 * the action is already represented by a separate
 * ``commandExecution`` / ``mcpToolCall`` item, and the observation is
 * that tool's ``aggregatedOutput`` / ``result``. Rendering them again
 * inside the message bubble is noise.
 *
 * If no ReAct markers are present at all, the whole text is returned
 * as ``finalAnswer`` unchanged, so non-ReAct agents (e.g. a plain
 * chat reply) stay pristine.
 *
 * Exported for direct unit tests.
 */
export function splitReactTrace(text: string): {
  thought: string;
  publicUpdate: string;
  finalAnswer: string;
} {
  if (!text) return { thought: "", publicUpdate: "", finalAnswer: "" };
  // Markers are recognised across all supported locales (en / zh /
  // ja / ko). The union regex lives in `@/core/i18n/llmMarkers` so
  // the spelling stays in one place — keep this function free of
  // hardcoded bilingual alternations.
  if (!hasLLMTraceMarkers(text)) {
    return { thought: "", publicUpdate: "", finalAnswer: text };
  }
  const segs = segmentLLMTrace(text);

  const thoughts: string[] = [];
  const updates: string[] = [];
  let finalAnswer = "";
  for (const seg of segs) {
    const clean = seg.text.trim();
    if (!clean) continue;
    if (seg.kind === "thought") thoughts.push(clean);
    else if (seg.kind === "update") updates.push(clean);
    else if (seg.kind === "finalAnswer") finalAnswer = clean; // last one wins
    // action + observation + prelude are intentionally dropped
  }
  // If the LLM never emitted a Final Answer (e.g. turn interrupted,
  // or still streaming an intermediate step) show the most recent
  // thought as the placeholder bubble text so the message isn't
  // empty. Otherwise the Final Answer wins outright.
  if (!finalAnswer && thoughts.length > 0) {
    return {
      thought: thoughts.slice(0, -1).join("\n\n"),
      publicUpdate: updates.at(-1) ?? "",
      finalAnswer: "",
    };
  }
  return {
    thought: thoughts.join("\n\n"),
    publicUpdate: updates.at(-1) ?? "",
    finalAnswer,
  };
}
