import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type { RemoteAgent } from "./a2a-agents-types";

// ---------------------------------------------------------------------------
// Agent detail · endpoint, description, capabilities and skills
// ---------------------------------------------------------------------------

export function AgentInfoSections({ agent }: { agent: RemoteAgent }) {
  const { t } = useI18n();
  return (
    <>
      {/* Info section */}
      <div className="space-y-3 border-b px-4 py-3">
        <div>
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t.a2a.endpoint}
          </span>
          <p className="mt-0.5 truncate text-xs">{agent.base_url}</p>
        </div>
        {agent.description && (
          <div>
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {t.a2a.description}
            </span>
            <p className="text-foreground/80 mt-0.5 text-xs leading-relaxed">
              {agent.description}
            </p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t.a2a.capabilities}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <CapabilityBadge
              label={t.a2a.streaming}
              enabled={agent.capabilities?.streaming}
            />
            <CapabilityBadge
              label={t.a2a.multiTurn}
              enabled={agent.capabilities?.multiTurn}
            />
            <CapabilityBadge
              label={t.a2a.push}
              enabled={agent.capabilities?.pushNotifications}
            />
          </div>
        </div>
      </div>

      {/* Skills */}
      {agent.skills.length > 0 && (
        <div className="border-b px-4 py-3">
          <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t.a2a.skills} ({agent.skills.length})
          </span>
          <div className="mt-2 space-y-2">
            {agent.skills.map((skill) => (
              <div key={skill.id} className="rounded-lg bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium">{skill.name}</p>
                {skill.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {skill.description}
                  </p>
                )}
                {skill.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skill.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-1 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Capability badge
// ---------------------------------------------------------------------------

function CapabilityBadge({
  label,
  enabled,
}: {
  label: string;
  enabled?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-medium",
        enabled
          ? "bg-success/10 text-success"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-lg",
          enabled ? "bg-success" : "bg-muted-foreground/30",
        )}
      />
      {label}
    </span>
  );
}
