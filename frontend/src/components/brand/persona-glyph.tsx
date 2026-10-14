import { EchoOrbGlyph } from "@/components/brand/echo-brand-mark";
import { canonicalAgentId } from "@/core/agents/aliases";
import { cn } from "@/lib/utils";

/**
 * Persona and skill glyphs (BRAND.md: emoji are never icons). An agent is
 * drawn by its portrait when it has one; otherwise by a neutral monogram
 * tile. The default Echo agent is the product's own assistant and wears the
 * ECHO mark instead of a portrait or a letter.
 */

/** Whether this id (or a legacy alias of it) is the default Echo agent. */
export function isEchoAgentId(id: string | null | undefined): boolean {
  const normalized = id?.trim().toLowerCase();
  return Boolean(normalized) && canonicalAgentId(normalized!) === "echo";
}

/** First letter of the name, upper-cased; never an emoji. */
export function personaInitial(name: string | null | undefined): string {
  for (const ch of (name ?? "").trim()) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch.toUpperCase();
  }
  return "?";
}

/** Text that is a picture rather than a letter (emoji, pictographs). */
export function isPictographic(value: string | null | undefined): boolean {
  return Boolean(value && /\p{Extended_Pictographic}/u.test(value));
}

/** Fills its (sized, shaped) parent with the persona's fallback glyph. */
export function PersonaGlyph({
  agentId,
  name,
  className,
}: {
  agentId?: string | null;
  name?: string | null;
  className?: string;
}) {
  if (isEchoAgentId(agentId)) {
    return (
      <EchoOrbGlyph className={cn("size-[72%] text-foreground", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-persona-glyph="monogram"
      className={cn(
        "font-semibold leading-none text-muted-foreground",
        className,
      )}
    >
      {personaInitial(name || agentId)}
    </span>
  );
}
