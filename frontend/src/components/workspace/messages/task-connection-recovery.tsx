import { useState } from "react";
import type { Message } from "@/core/api/types";
import { useI18n } from "@/core/i18n/hooks";
import { RoleConnections } from "../agents/role-connections";

export interface TaskConnectionIssue {
  agentId: string;
  connectors: string[];
}

/** Only structured host errors carry repair metadata, never model prose. */
export function taskConnectionIssue(
  messages: Message[],
): TaskConnectionIssue | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const error = message.additional_kwargs?.error as
      | { info?: Record<string, unknown> }
      | undefined;
    const info = error?.info;
    if (info?.code !== "role_connections_unavailable") continue;
    const ids = info.connectors;
    const validId = (id: unknown): id is string =>
      typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id);
    if (
      !validId(info.agent_id) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 64 ||
      !ids.every(validId)
    )
      return null;
    return { agentId: info.agent_id, connectors: [...new Set(ids)] };
  }
  return null;
}

export function TaskConnectionRecovery({
  issue,
  busy,
  onContinue,
}: {
  issue: TaskConnectionIssue;
  busy: boolean;
  onContinue?: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  return (
    <div className="w-full space-y-2 text-xs">
      <button
        type="button"
        className="underline underline-offset-4"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {zh ? "修复所需连接" : "Repair required connections"}
      </button>
      {open && (
        <RoleConnections
          key={JSON.stringify(issue)}
          agentId={issue.agentId}
          connectors={issue.connectors}
          mcpServers={[]}
          onConfigured={setConfigured}
        />
      )}
      {open && onContinue && (
        <button
          type="button"
          disabled={!configured || busy}
          className="ml-3 rounded-md border px-2 py-1 disabled:opacity-50"
          onClick={() => {
            if (configured && !busy) {
              setConfigured(false);
              onContinue();
            }
          }}
        >
          {busy
            ? zh
              ? "正在继续…"
              : "Continuing…"
            : zh
              ? "继续当前任务"
              : "Continue this task"}
        </button>
      )}
    </div>
  );
}
