import {
  BotIcon,
  ChevronRightIcon,
  FilePlus2Icon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useSubtask } from "@/core/tasks/context";
import { cn } from "@/lib/utils";

import { emitAgentWorkbenchFocus } from "./agent-workbench-events";
import {
  basename,
  type ObservedReferenceItem,
  type ObservedReferenceTabId,
} from "./agent-workbench-references";
import {
  type AgentTile,
  type DiffEntry,
  subagentAvatarSrc,
} from "./agent-workbench-utils";
import { SubtaskHoverPreview } from "./messages/parallel-subtasks-grid";

export function SummaryDiffEntryList({
  entries,
  kind,
  onOpenEntry,
}: {
  entries: DiffEntry[];
  kind: "artifact" | "change";
  onOpenEntry?: (entry: DiffEntry, kind: "artifact" | "change") => void;
}) {
  const { t } = useI18n();
  const Icon = kind === "artifact" ? FilePlus2Icon : FileTextIcon;
  return (
    <ul className="stable-scroll-viewport max-h-48 overflow-x-hidden overflow-y-auto">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onOpenEntry?.(entry, kind)}
            className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={
              kind === "artifact"
                ? t.agentWorkbenchPages.openArtifact(entry.title)
                : t.agentWorkbenchPages.viewDiff(entry.title)
            }
            title={entry.path}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                kind === "artifact"
                  ? "text-foreground/80"
                  : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {basename(entry.title || entry.path)}
            </span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReferenceIcon({
  fallbackClassName,
  Icon,
  item,
  tabId,
}: {
  fallbackClassName: string;
  Icon: LucideIcon;
  item: ObservedReferenceItem;
  tabId: ObservedReferenceTabId;
}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = item.thumbnailUrl || item.faviconUrl;
  const hostInitial = item.host?.charAt(0).toUpperCase();
  const canShowImage = tabId === "web" && imageUrl && !failed;

  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center overflow-hidden text-muted-foreground",
      )}
    >
      {canShowImage ? (
        <img
          src={imageUrl}
          alt={item.host ? `${item.host} icon` : ""}
          className={cn(
            "size-full object-cover",
            item.thumbnailUrl ? "rounded-sm" : "",
          )}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : hostInitial ? (
        <span className="text-xs font-semibold text-muted-foreground">
          {hostInitial}
        </span>
      ) : (
        <Icon className={cn("size-4", fallbackClassName)} />
      )}
    </span>
  );
}

// 子 agent 行 — 与对话区 MiniSubtaskRow 同一实体化体验：
// 头像 + hover popover（复用 SubtaskHoverPreview）+ 点击/按钮跳转。
export function SummaryAgentRow({ tile }: { tile: AgentTile }) {
  const { t } = useI18n();
  const subtask = useSubtask(tile.id);
  const displayLabel =
    tile.taskLabel ?? tile.codename ?? tile.name ?? tile.label;
  const previewId = `subtask-preview-${tile.id}`;
  const statusLabel = subtask
    ? (() => {
        const raw = t.subagents[subtask.status];
        return typeof raw === "string" ? raw : subtask.status;
      })()
    : "";
  const avatarEmoji = subtask?.avatarEmoji ?? tile.avatar;
  const hue = subtask?.hue;
  const avatarSrc = subagentAvatarSrc(tile.avatarUrl);

  const handleClick = () => {
    emitAgentWorkbenchFocus({
      agentId: tile.id,
      tab: "agent",
      view: "role",
    });
  };

  return (
    <li className="group/subtask-row relative flex items-start gap-3">
      <button
        type="button"
        onClick={handleClick}
        // See MiniSubtaskRow: suppress mouse-click focus so the hover
        // preview doesn't stay pinned via group-focus-within after a click.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={displayLabel}
        aria-describedby={subtask ? previewId : undefined}
        className="absolute inset-0 cursor-pointer rounded-lg"
      />
      <span
        className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs text-muted-foreground"
        style={hue != null ? { background: `hsl(${hue} 70% 92%)` } : undefined}
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="size-full object-cover" />
        ) : (
          (avatarEmoji ?? <BotIcon className="size-3" />)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {displayLabel}
          </span>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              tile.status === "error"
                ? "bg-destructive"
                : tile.status === "running"
                  ? "bg-success"
                  : tile.status === "waiting_approval"
                    ? "bg-warning"
                    : tile.status === "done"
                      ? "bg-muted-foreground/45"
                      : "bg-muted-foreground/35",
            )}
            aria-hidden="true"
          />
        </span>
        {(tile.resultSummary ?? tile.error ?? tile.lastThought) && (
          <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
            {tile.error ?? tile.resultSummary ?? tile.lastThought}
          </span>
        )}
      </span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      {subtask && (
        <SubtaskHoverPreview
          task={subtask}
          statusLabel={statusLabel}
          id={previewId}
        />
      )}
    </li>
  );
}
