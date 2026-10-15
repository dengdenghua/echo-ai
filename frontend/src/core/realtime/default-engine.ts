/**
 * The engine a conversation starts on before the person picks one.
 *
 * A pick saved for the conversation (or inherited from the one it was forked
 * from) always wins and never reaches this module. Otherwise the person's
 * last explicit pick holds while it can still answer, then an engine that can
 * answer right now: OpenCode with a model, Auto on Echo's own models, or a
 * signed-in Codex. With none of them it stays where it always started, and
 * the composer shows the first-run setup line.
 */
import type { ExecutionEnginePreference } from "./execution-policy";

export interface EngineReadiness {
  /** Every readiness answer arrived; until then the synchronous default holds. */
  known: boolean;
  /** OpenCode is not installed on this computer yet. */
  opencodeMissing: boolean;
  /** OpenCode runs and has a model for this conversation's pick. */
  opencodeReady: boolean;
  /** Codex is configured and signed in. */
  codexReady: boolean;
  /** Echo's own catalog lists a model that answers. */
  echoReady: boolean;
}

/** Whether a choice can answer now. Auto always resolves to some engine. */
export function canAnswerOn(
  choice: ExecutionEnginePreference,
  readiness: EngineReadiness,
): boolean {
  if (choice === "codex") return readiness.codexReady;
  if (choice === "opencode") return readiness.opencodeReady;
  if (choice === "echo") return readiness.echoReady;
  return true;
}

export function defaultExecutionEngine({
  independent,
  lastChoice,
  readiness,
}: {
  /** A single-agent task the person drives; teams and Codex roles use Auto. */
  independent: boolean;
  /** The person's last explicit pick in any conversation. */
  lastChoice: ExecutionEnginePreference | null;
  readiness: EngineReadiness;
}): ExecutionEnginePreference {
  if (!independent) return "auto";
  // Their own earlier pick may be used before readiness arrives: waiting
  // would briefly submit something else to another provider.
  if (lastChoice && (!readiness.known || canAnswerOn(lastChoice, readiness)))
    return lastChoice;
  const initial = readiness.opencodeMissing ? "auto" : "opencode";
  if (!readiness.known || readiness.opencodeReady) return initial;
  // The order Auto itself follows when OpenCode cannot answer: Echo's own
  // models, then a signed-in Codex.
  if (readiness.echoReady) return "auto";
  if (readiness.codexReady) return "codex";
  return initial;
}
