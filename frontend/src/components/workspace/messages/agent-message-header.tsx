import { Badge } from "@/components/ui/badge";
import { getBackendBaseURL } from "@/core/config";
import { isEchoAgentId, PersonaGlyph } from "@/components/brand/persona-glyph";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface AgentMessageHeaderProps {
  agentDisplayName: string;
  avatarUrl?: string;
  icon?: string | null;
  role?: "tl" | "member";
}

export function AgentAvatar({
  agentDisplayName,
  agentId,
  avatarUrl,
  className = "h-6 w-6 rounded-lg",
}: {
  agentDisplayName: string;
  /** Lets the default Echo agent wear the ECHO mark. */
  agentId?: string | null;
  avatarUrl?: string;
  /** Legacy emoji icon; accepted for callers but never drawn (BRAND.md). */
  icon?: string | null;
  className?: string;
}) {
  const backendBase = getBackendBaseURL();
  const fullAvatarUrl = avatarUrl
    ? avatarUrl.startsWith("http")
      ? avatarUrl
      : `${backendBase}${avatarUrl}`
    : null;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    setFailedAvatarUrl(null);
  }, [fullAvatarUrl]);
  const showImage =
    !isEchoAgentId(agentId) &&
    Boolean(fullAvatarUrl && failedAvatarUrl !== fullAvatarUrl);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-border-default bg-muted text-xs leading-none",
        className,
      )}
    >
      {showImage && fullAvatarUrl ? (
        <img
          src={fullAvatarUrl}
          alt={agentDisplayName}
          className="h-full w-full object-cover"
          onError={() => setFailedAvatarUrl(fullAvatarUrl)}
        />
      ) : (
        <PersonaGlyph agentId={agentId} name={agentDisplayName} />
      )}
    </div>
  );
}

export function AgentMessageHeader({
  agentDisplayName,
  avatarUrl,
  icon,
  role,
}: AgentMessageHeaderProps) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-2 first:mt-0">
      <AgentAvatar
        agentDisplayName={agentDisplayName}
        avatarUrl={avatarUrl}
        icon={icon}
      />
      <span className="text-sm font-semibold">{agentDisplayName}</span>
      {role === "tl" && (
        <Badge
          variant="outline"
          className="border-border bg-muted/60 text-muted-foreground px-1.5 py-0 text-xs leading-4"
        >
          TL
        </Badge>
      )}
    </div>
  );
}
