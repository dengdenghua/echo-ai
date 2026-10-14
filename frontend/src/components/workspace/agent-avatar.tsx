import { useState } from "react";
import type { Agent } from "@/core/agents/types";
import { withAgentAvatarVersion } from "@/core/agents/avatar";
import { canonicalAgentId } from "@/core/agents/aliases";
import { builtinPersonaDisplayName } from "@/core/agents/persona-display";
import { getBackendBaseURL } from "@/core/config";
import { isEchoAgentId, PersonaGlyph } from "@/components/brand/persona-glyph";
import { cn } from "@/lib/utils";

/** Resolve ``Agent.avatar_url`` to an absolute URL the browser can load. */
function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return withAgentAvatarVersion(url);
  }
  // API avatars belong to the Python gateway. Imported Vite assets must stay
  // on the frontend origin (and may be relative in the packaged Electron app).
  if (url.startsWith("/api/") || url.startsWith("api/")) {
    const path = url.startsWith("/") ? url : `/${url}`;
    return withAgentAvatarVersion(`${getBackendBaseURL()}${path}`);
  }
  return withAgentAvatarVersion(url);
}

// ─── Avatar components ───────────────────────────────────────────

export function AgentAvatar({
  agent,
  className,
}: {
  agent:
    | Pick<Agent, "name" | "display_name" | "avatar_url" | "icon">
    | undefined;
  className?: string;
}) {
  const personaId = canonicalAgentId(agent?.name ?? "");
  const isEcho = isEchoAgentId(personaId);
  // Emoji `icon` values are never drawn (BRAND.md): a portrait when the
  // agent has one, otherwise a neutral monogram; Echo wears the ECHO mark.
  // Try the advertised avatar first, then the persona's own avatar route:
  // a stale avatar_url must not leave a built-in persona on its monogram.
  const candidates = isEcho
    ? []
    : [
        resolveAvatarUrl(agent?.avatar_url),
        builtinPersonaDisplayName(personaId)
          ? resolveAvatarUrl(`/api/agents/${personaId}/avatar`)
          : null,
      ].filter(
        (url, index, all): url is string =>
          Boolean(url) && all.indexOf(url) === index,
      );
  const [failedAvatars, setFailedAvatars] = useState<string[]>([]);
  const avatar = candidates.find((url) => !failedAvatars.includes(url)) ?? null;
  const showAvatar = Boolean(avatar);
  return (
    <span
      aria-hidden="true"
      data-agent-avatar={personaId || undefined}
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-default bg-muted text-xs leading-none",
        className,
      )}
    >
      <PersonaGlyph
        agentId={personaId}
        name={agent?.display_name || agent?.name}
      />
      {showAvatar && (
        // Eager: these sit in menus and lists that open on demand, where a
        // lazy image could stay on the monogram (AI-41).
        <img
          key={avatar}
          src={avatar ?? undefined}
          alt=""
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          onError={() =>
            setFailedAvatars((failed) =>
              avatar && !failed.includes(avatar) ? [...failed, avatar] : failed,
            )
          }
        />
      )}
    </span>
  );
}
