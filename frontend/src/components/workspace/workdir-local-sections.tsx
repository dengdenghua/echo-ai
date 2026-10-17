import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";

import {
  avatarTile,
  browseEntryPath,
  entryDisplayName,
  type FsTreeEntry,
} from "./workdir-selector-utils";

/** CTA tile for the implemented workspace picker entry point. */
export function WorkdirFolderPickerCta({
  isMutedVariant,
  isPicking,
  label,
  onClick,
}: {
  isMutedVariant: boolean;
  isPicking: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 transition-colors",
        isMutedVariant
          ? "rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          : "rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary",
        !isMutedVariant && "hover:border-primary/30 hover:bg-primary/15",
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-md",
          isMutedVariant ? "size-5" : "size-7 bg-background/80",
        )}
      >
        {isPicking ? (
          <Loader2Icon
            className={cn(
              "animate-spin",
              isMutedVariant ? "size-3.5" : "size-4",
            )}
          />
        ) : (
          <FolderOpenIcon className={isMutedVariant ? "size-3.5" : "size-4"} />
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">{label}</span>
    </button>
  );
}

/** Recent workspaces: colored letter tile, path subtitle, ✓ on the active one. */
export function WorkdirRecentList({
  recentWorkdirs,
  workDir,
  isMutedVariant,
  onChoose,
}: {
  recentWorkdirs: string[];
  workDir: string;
  isMutedVariant: boolean;
  onChoose: (dir: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "border-t border-border-default",
        isMutedVariant ? "px-1.5 py-1.5" : "px-2.5 py-2",
      )}
    >
      <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t.codeMode.recentWorkspaces}
      </div>
      {recentWorkdirs.length > 0 ? (
        <div
          className={cn(
            "space-y-0.5 overflow-y-auto pr-1",
            isMutedVariant ? "max-h-32" : "max-h-44",
          )}
        >
          {recentWorkdirs.map((dir) => {
            const tile = avatarTile(dir);
            const active = dir === workDir;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => onChoose(dir)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors",
                  active ? "bg-primary/10 text-primary" : "hover:bg-muted/55",
                )}
                title={dir}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold",
                    tile.bg,
                    tile.fg,
                  )}
                >
                  {tile.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {basename(dir) || dir}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground/80">
                    {dir}
                  </div>
                </span>
                {active && (
                  <CheckIcon className="size-3.5 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-default bg-muted/20 px-2 py-3 text-center text-xs text-muted-foreground">
          {t.codeMode.noRecentWorkspaces}
        </div>
      )}
    </div>
  );
}

/** In-page directory browser, collapsed by default. */
export function WorkdirFolderBrowser({
  open,
  onOpenChange,
  browsePath,
  upDir,
  onBrowse,
  browseLoading,
  browseEntries,
  isMutedVariant,
  onEnterDirectory,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  browsePath: string;
  upDir: string | null;
  onBrowse: (path: string) => void;
  browseLoading: boolean;
  browseEntries: FsTreeEntry[];
  isMutedVariant: boolean;
  onEnterDirectory: (entryPath: string) => void;
  onChoose: (dir: string) => void;
}) {
  const { t } = useI18n();
  return (
    <details
      className="group border-t border-border-default px-2.5 py-2"
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        <span className="inline-flex items-center gap-1">
          <ChevronDownIcon className="size-3 transition-transform group-open:rotate-180" />
          {t.codeMode.browseCurrentFolder}
        </span>
      </summary>
      <div className="mt-1">
        <div
          className="px-1 pb-1 text-xs font-mono text-muted-foreground/80 truncate"
          title={browsePath}
        >
          {browsePath || "—"}
        </div>
        {upDir && (
          <button
            type="button"
            onClick={() => onBrowse(upDir)}
            className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            .. / {t.codeMode.parentFolder}
          </button>
        )}
        {browseLoading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            {t.codeMode.loadingFolders}
          </div>
        ) : browseEntries.length > 0 ? (
          <div
            className={cn(
              "mt-1 space-y-0.5 overflow-auto",
              isMutedVariant ? "max-h-28" : "max-h-56",
            )}
          >
            {browseEntries.map((entry) => {
              const nextPath = browseEntryPath(browsePath, entry.path);
              const displayName = entryDisplayName(entry);
              return (
                <div
                  key={`${browsePath}:${entry.path}`}
                  className="flex items-center gap-1"
                >
                  <button
                    type="button"
                    onClick={() => onEnterDirectory(entry.path)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    title={nextPath}
                  >
                    <FolderIcon className="size-3 shrink-0" />
                    <span className="truncate">{displayName}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChoose(nextPath)}
                    className="rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10"
                    title={t.codeMode.chooseWorkspaceFolder}
                    aria-label={t.codeMode.chooseWorkspaceFolder}
                  >
                    <CheckIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {t.codeMode.noSubfolders}
          </div>
        )}
      </div>
    </details>
  );
}
