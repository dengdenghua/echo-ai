import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { worktreeCopy } from "@/core/i18n/locales/worktrees";
import { sessionStatusCopy } from "@/core/i18n/locales/session-status";
import { registerSessionStatusMenu } from "@/core/realtime/session-status-menu";
import { artifactDisplayPath } from "@/core/artifacts/utils";
import { getFileIcon, getFileName } from "@/core/utils/files";
import { useOptionalArtifacts } from "./artifacts/context";
import {
  ContextRing,
  contextUsage,
  ringColorClass,
} from "./chat-input-box/context-usage-details";

/** The menu lists the first few outputs; the 产物 tab has them all. */
const OUTPUTS_SHOWN = 5;
import {
  SessionContextSection,
  SessionEnvironmentRows,
  type SessionContextStatus,
  type SessionEnvironment,
} from "./session-status-sections";
import { WorktreeDialog } from "./worktree-dialog";
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
import { cn } from "@/lib/utils";
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
  /** Opens the workbench's 产物 tab with every output. */
  onOpenAllOutputs?: () => void;
  /** Where the conversation runs; rows lead the 环境 section. */
  environment?: SessionEnvironment;
  /** Context usage and manual compression. While given, the composer's
   * context ring links here instead of compressing by itself. */
  context?: SessionContextStatus;
}

/**
 * The chat header's status menu (三横): 环境, 上下文, 产出 and 来源. A transient
 * menu; it never restores the old floating-card state.
 */
export function WorkspaceContextMenu({
  workDir,
  events,
  userInput,
  groundingSources = [],
  onOpenDiff,
  onOpenFile,
  environment,
  context,
  onOpenAllOutputs,
}: WorkspaceContextMenuProps) {
  const { t, locale } = useI18n();
  const copy = sessionStatusCopy(locale);
  const [open, setOpen] = useState(false);
  const outputs = useOptionalArtifacts()?.artifacts ?? [];
  const ownsCompression = Boolean(context?.onCompressContext);
  useEffect(
    () =>
      ownsCompression
        ? registerSessionStatusMenu(() => setOpen(true))
        : undefined,
    [ownsCompression],
  );
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const navigate = useNavigate();
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
  const sectionLabelClass =
    "px-2 pb-1 pt-4 text-xs font-normal text-muted-foreground first:pt-0.5";
  const menuTitle = context || environment ? copy.menuTitle : t.workspaceNote.menuTitle;
  const usage = contextUsage(
    context?.contextTokens ?? 0,
    context?.maxContextTokens ?? 0,
  );

  return (
    <>
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
          aria-label={menuTitle}
          title={context ? `${menuTitle} · ${usage.summary}` : menuTitle}
          className="flex h-[42px] min-w-[42px] shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/70 data-[state=open]:text-foreground sm:h-8 sm:min-w-8"
        >
          {context ? (
            <span
              className={cn(
                "flex items-center gap-1",
                ringColorClass(usage.progress),
              )}
            >
              <ContextRing
                progress={usage.progress}
                compressing={context.isCompressingContext}
                trackClassName="opacity-45"
              />
              {/* The number appears once there is something to count. */}
              {usage.percentage >= 1 ? (
                <span className="font-mono text-xs tabular-nums">
                  {usage.percentage}%
                </span>
              ) : null}
            </span>
          ) : (
            <ListFilterIcon className="size-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        aria-label={menuTitle}
        className="max-h-[min(40rem,var(--radix-dropdown-menu-content-available-height))] w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border-border-subtle bg-popover p-3 shadow-[0_4px_20px_rgb(0_0_0/0.08)] dark:shadow-[0_4px_20px_rgb(0_0_0/0.3)]"
      >
        {(environment || workDir) && (
          <DropdownMenuLabel className={sectionLabelClass}>
            {environment ? copy.environment : t.workspaceNote.environmentSection}
          </DropdownMenuLabel>
        )}
        {environment && <SessionEnvironmentRows environment={environment} />}
        {workDir && (
          <>
            {hasRepository && summary && (
              <DropdownMenuItem className={rowClass} onSelect={() => setWorktreesOpen(true)}>
                <GitForkIcon className="size-3.5" />
                <span>{worktreeCopy(locale).title}</span>
              </DropdownMenuItem>
            )}
            {hasRepository && summary && (
              <DropdownMenuItem className={rowClass} onSelect={onOpenDiff}>
                <FileDiffIcon className="size-3.5" />
                <span>{t.workspaceNote.changesLabel}</span>
                <span className="ml-auto flex gap-1 font-mono text-[11px] tabular-nums">
                  {summary.changedFiles ? (
                    <>
                      <span className="text-core">
                        +{format(summary.added)}
                      </span>
                      <span className="text-breach">
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
            {/* 工作位置 already says 本地; only a worktree adds something. */}
            {(!environment || summary?.worktree) && <div
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
            </div>}
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
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {t.workspaceNote.diffUnavailable}
              </p>
            )}
            {!!summary?.untrackedFiles && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {t.workspaceNote.trackedOnly}
              </p>
            )}
          </>
        )}
        {context && (
          <>
            <DropdownMenuLabel className={`${sectionLabelClass} flex items-center justify-between gap-3`}>
              {copy.context}
              <span className="flex items-center gap-1.5">
                {!context.measured && (
                  <span
                    title={copy.estimatedHint}
                    className="rounded border border-border-default px-1 text-xs leading-4"
                  >
                    {copy.estimated}
                  </span>
                )}
                <span className="font-mono tabular-nums">{usage.summary}</span>
              </span>
            </DropdownMenuLabel>
            <SessionContextSection status={context} />
          </>
        )}
        {(context || environment) && (
          <>
            <DropdownMenuLabel className={sectionLabelClass}>
              {copy.outputs}
              {outputs.length > 0 ? (
                <span className="ml-1.5 font-mono tabular-nums">{outputs.length}</span>
              ) : null}
            </DropdownMenuLabel>
            {outputs.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {copy.noOutputs}
              </p>
            )}
            {outputs.slice(0, OUTPUTS_SHOWN).map((file) => {
              const displayPath = artifactDisplayPath(file);
              return (
                <DropdownMenuItem
                  key={file}
                  className={rowClass}
                  title={displayPath}
                  onSelect={() => onOpenFile(file)}
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                    {getFileIcon(displayPath, "size-3.5")}
                  </span>
                  <span className="truncate">{getFileName(displayPath)}</span>
                </DropdownMenuItem>
              );
            })}
            {outputs.length > OUTPUTS_SHOWN && onOpenAllOutputs && (
              <DropdownMenuItem
                className={`${rowClass} text-muted-foreground`}
                onSelect={onOpenAllOutputs}
              >
                <span className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{copy.viewAllOutputs(outputs.length)}</span>
              </DropdownMenuItem>
            )}
          </>
        )}
        {/* With the status sections above, an empty 来源 is just noise. */}
        {(sources.length > 0 || !(context || environment)) && (
        <DropdownMenuLabel className={sectionLabelClass}>
          {t.workspaceNote.sourcesTitle}
        </DropdownMenuLabel>
        )}
        {sources.length === 0 && !(context || environment) && (
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
    <WorktreeDialog open={worktreesOpen} onOpenChange={setWorktreesOpen} projectPath={workDir ?? ""}
      onOpenTask={(workspacePath) => { void navigate(taskWorkspaceRoute({ workspacePath })); }} />
    </>
  );
}
