import { useMemo, useState } from "react";
import {
  FileDiffIcon,
  FileTextIcon,
  GitBranchIcon,
  GitForkIcon,
  GlobeIcon,
  ListFilterIcon,
  MonitorIcon,
  RefreshCwIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { useI18n } from "@/core/i18n/hooks";
import {
  isPrivateAgentGroundingSource,
  type GroundingSource,
} from "@/core/realtime/items";
import { useGitSummary } from "@/core/workspace/use-git-summary";
import { buildObservedReferenceTabs } from "./agent-workbench-pages";
import type { LiveToolEvent } from "./live-tool-timeline";
import { toWorkBlocks } from "./work-blocks";

interface Source {
  title: string;
  path?: string;
  url?: string;
}

export interface WorkspaceContextMenuProps {
  workDir?: string | null;
  events: LiveToolEvent[];
  userInput?: {
    uploadedFiles: Array<{ filename: string; path: string }>;
    attachments: Array<{ filename: string }>;
  } | null;
  groundingSources?: GroundingSource[];
  onOpenDiff: () => void;
  onOpenFile: (path: string) => void;
}

/** A transient header menu; it never restores the old floating-card state. */
export function WorkspaceContextMenu({
  workDir,
  events,
  userInput,
  groundingSources = [],
  onOpenDiff,
  onOpenFile,
}: WorkspaceContextMenuProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const { summary, error, isLoading, refresh } = useGitSummary(workDir, {
    enabled: open,
  });
  const sources = useMemo(() => {
    if (!open) return [];
    const items: Source[] = [
      ...(userInput?.uploadedFiles ?? []).map((file) => ({
        title: file.filename,
        path: file.path,
      })),
      ...(userInput?.attachments ?? []).map((file) => ({
        title: file.filename,
      })),
      ...groundingSources
        .filter((source) => !isPrivateAgentGroundingSource(source))
        .map((source) =>
          /^https?:\/\//i.test(source.path)
            ? { title: source.title, url: source.path }
            : { title: source.title, path: source.path },
        ),
      ...buildObservedReferenceTabs(toWorkBlocks(events), t).flatMap((tab) =>
        tab.items.map((item) => ({ title: item.title, url: item.url, path: item.path })),
      ),
    ];
    const seen = new Set<string>();
    const fileNames = new Set<string>();
    return items.filter((item) => {
      const key = item.url || item.path || item.title;
      if (
        !key ||
        seen.has(key) ||
        (!item.url && !item.path && fileNames.has(item.title))
      )
        return false;
      seen.add(key);
      if (!item.url) fileNames.add(item.title);
      return true;
    });
  }, [open, userInput, groundingSources, events, t]);
  const hasRepository = !!(
    summary?.branch ||
    summary?.detached ||
    summary?.changedFiles
  );
  const format = (value: number) => value.toLocaleString(locale);
  const rowClass = "min-h-8 gap-2.5 rounded-lg px-2 text-xs";

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="workspace-context-trigger"
          aria-label={t.workspaceNote.menuTitle}
          title={t.workspaceNote.menuTitle}
          className="flex size-[42px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/70 data-[state=open]:text-foreground sm:size-8"
        >
          <ListFilterIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        aria-label={t.workspaceNote.menuTitle}
        className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-[300px] max-w-[calc(100vw-24px)] rounded-2xl border-border-subtle bg-popover p-3 shadow-[0_4px_20px_rgb(0_0_0/0.08)] dark:shadow-[0_4px_20px_rgb(0_0_0/0.3)]"
      >
        {workDir && (
          <>
            <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-xs font-normal text-muted-foreground">
              {t.workspaceNote.environmentSection}
            </DropdownMenuLabel>
            {hasRepository && summary && (
              <DropdownMenuItem className={rowClass} onSelect={onOpenDiff}>
                <FileDiffIcon className="size-3.5" />
                <span>{t.workspaceNote.changesLabel}</span>
                <span className="ml-auto flex gap-1 font-mono text-[11px] tabular-nums">
                  {summary.changedFiles ? (
                    <>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{format(summary.added)}
                      </span>
                      <span className="text-red-500">
                        -{format(summary.removed)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {t.workspaceNote.clean}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            )}
            <div
              className="flex min-h-8 items-center gap-2.5 px-2 text-xs"
              title={workDir}
            >
              {summary?.worktree ? (
                <GitForkIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <MonitorIcon className="size-3.5 text-muted-foreground" />
              )}
              <span>
                {summary?.worktree
                  ? t.workspaceNote.worktreeEnv
                  : t.workspaceNote.localEnv}
              </span>
            </div>
            {hasRepository && summary && (
              <div
                className="flex min-h-8 items-center gap-2.5 rounded-lg bg-muted/55 px-2 text-xs"
                title={summary.branch || t.workspaceNote.detachedHead}
              >
                <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {summary.branch || t.workspaceNote.detachedHead}
                </span>
              </div>
            )}
            {isLoading && (
              <p
                className="px-2 py-1 text-xs text-muted-foreground"
                role="status"
              >
                {t.common.loading}
              </p>
            )}
            {error && (
              <DropdownMenuItem
                className={rowClass}
                onSelect={(event) => {
                  event.preventDefault();
                  void refresh();
                }}
              >
                <RefreshCwIcon className="size-3.5" />
                <span>{t.workspaceNote.refresh}</span>
                <span className="sr-only">
                  {t.workspaceNote.unavailableFresh}
                </span>
              </DropdownMenuItem>
            )}
            {summary?.diffError && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {t.workspaceNote.diffUnavailable}
              </p>
            )}
            {!!summary?.untrackedFiles && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {t.workspaceNote.trackedOnly}
              </p>
            )}
          </>
        )}
        <DropdownMenuLabel
          className={`px-2 pb-1 text-xs font-normal text-muted-foreground ${workDir ? "pt-5" : "pt-0.5"}`}
        >
          {t.workspaceNote.sourcesTitle}
        </DropdownMenuLabel>
        {sources.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {t.agentWorkbenchPages.noSources}
          </p>
        )}
        {sources.map((source, index) =>
          source.url && /^https?:\/\//i.test(source.url) ? (
            <DropdownMenuItem
              key={`${source.url}:${index}`}
              className={rowClass}
              asChild
            >
              <RoutedWebLink href={source.url} title={source.title}>
                <GlobeIcon className="size-3.5" />
                <span className="truncate">{source.title}</span>
              </RoutedWebLink>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              key={`${source.path || source.title}:${index}`}
              className={rowClass}
              title={source.title}
              disabled={!source.path}
              onSelect={() => { if (source.path) onOpenFile(source.path); }}
            >
              <FileTextIcon className="size-3.5" />
              <span className="truncate">{source.title}</span>
            </DropdownMenuItem>
          ),
        )}

      </DropdownMenuContent>
    </DropdownMenu>
  );
}
