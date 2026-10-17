import {
  CheckIcon,
  CloudIcon,
  DatabaseIcon,
  HardDriveIcon,
  Loader2Icon,
  RefreshCwIcon,
  ServerIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import type { MountType, Workspace } from "@/core/workspace/api";
import { cn } from "@/lib/utils";

// Remote mount type → lucide icon. Mirrors the WorkspaceSwitcher palette.
const MOUNT_TYPE_ICON: Record<MountType, LucideIcon> = {
  local: HardDriveIcon,
  smb: ServerIcon,
  nfs: ServerIcon,
  webdav: CloudIcon,
  sftp: TerminalIcon,
  s3: DatabaseIcon,
};

/** The workdir selector's "Remote mount" tab: shared directories and spaces. */
export function WorkdirRemotePanel({
  remoteWorkspaceEnabled,
  isMutedVariant,
  threadId,
  workspaceId,
  remoteWorkspaces,
  remoteLoading,
  remoteError,
  onRefresh,
  onPick,
  onConnectSharedDirectory,
  onAttachSharedSpace,
}: {
  remoteWorkspaceEnabled: boolean;
  isMutedVariant: boolean;
  threadId?: string;
  workspaceId?: string | null;
  remoteWorkspaces: Workspace[];
  remoteLoading: boolean;
  remoteError: string | null;
  onRefresh: () => void;
  onPick: (workspace: Workspace) => void;
  onConnectSharedDirectory: () => void;
  onAttachSharedSpace: () => void;
}) {
  const { t } = useI18n();
  const trRemote = t.remoteWorkspace;
  return (
    <div
      className={cn(
        "flex max-h-full flex-col overflow-hidden",
        remoteWorkspaceEnabled
          ? ""
          : "border border-border-default bg-popover/95 backdrop-blur rounded-lg shadow-2xl",
      )}
    >
      <div className={cn("shrink-0", isMutedVariant ? "p-1.5" : "p-2.5")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {trRemote.switcherTitle}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={remoteLoading}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            title={t.workLocation.refresh}
            aria-label={t.workLocation.refresh}
          >
            <RefreshCwIcon
              className={cn("size-3", remoteLoading && "animate-spin")}
              aria-hidden="true"
            />
          </button>
        </div>

        {remoteError && (
          <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            {trRemote.remoteLoadFailed(remoteError)}
          </div>
        )}

        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-md border px-2 py-1.5"
            onClick={onConnectSharedDirectory}
          >
            {t.workLocation.connectSharedDirectory}
          </button>
          {threadId && threadId !== "new" && (
            <button
              type="button"
              className="rounded-md border px-2 py-1.5"
              onClick={onAttachSharedSpace}
            >
              {t.workLocation.attachSharedSpace}
            </button>
          )}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {t.workLocation.sharedDirectoryHint}
        </p>

        {remoteLoading && remoteWorkspaces.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {trRemote.remoteLoading}
          </div>
        ) : remoteWorkspaces.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-default bg-muted/20 px-2 py-3 text-center text-xs text-muted-foreground">
            {trRemote.remoteEmpty}
          </div>
        ) : (
          <div className="space-y-0.5 overflow-y-auto pr-1 max-h-72">
            {remoteWorkspaces.map((ws) => {
              const Icon = MOUNT_TYPE_ICON[ws.mount_type];
              const active = ws.id === workspaceId;
              return (
                <button
                  key={ws.id}
                  type="button"
                  disabled={remoteLoading}
                  onClick={() => onPick(ws)}
                  title={ws.mount_target}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                    active ? "bg-primary/10 text-primary" : "hover:bg-muted/55",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md",
                      active
                        ? "bg-primary/15 text-primary"
                        : "bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {ws.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground/80">
                      {ws.mount_target}
                    </span>
                  </span>
                  {active && (
                    <CheckIcon className="size-3.5 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
