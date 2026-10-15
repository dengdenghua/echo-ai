/**
 * The workbench's 产物 tab: a flat list of the conversation's files and a
 * full-bleed preview of the chosen one (moved out of agent-workbench-panel.tsx).
 */
import {
  ArrowLeftIcon,
  DownloadIcon,
  PackageIcon,
  SparklesIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  artifactDisplayPath,
  normalizeWorkspaceArtifactRef,
  urlOfArtifact,
} from "@/core/artifacts/utils";
import {
  HtmlPreview,
  OfficePreview,
} from "@/components/workspace/artifacts/artifact-file-detail";
import { checkCodeFile, getFileIcon, getFileName } from "@/core/utils/files";
import { useI18n } from "@/core/i18n/hooks";
import { workbenchArtifactsCopy } from "@/core/i18n/locales/workbench-artifacts";
import { useArtifactContent } from "@/core/artifacts/hooks";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { officeArtifactKind } from "@/components/workspace/artifacts/office-edit";
import { ArtifactLink } from "@/components/workspace/citations/artifact-link";
import { useStreamdownPlugins } from "@/core/streamdown";
import type { StreamdownProps } from "streamdown";
import type { DiffEntry } from "../agent-workbench-utils";

const LazyStreamdown = lazy(
  () => import("@/components/ai-elements/streamdown-host"),
);
// The same read-only CodeMirror view the artifact drawer uses for code; its
// chunk loads only when a code or text file is previewed.
const LazyCodeEditor = lazy(() =>
  import("@/components/workspace/code-editor").then((m) => ({
    default: m.CodeEditor,
  })),
);

/** Rendering more than this freezes the panel; the full file is a download. */
const CODE_PREVIEW_LIMIT = 200 * 1024;

/**
 * Two-state artifact panel for the workbench's "产物" tab.
 *
 * State 1 – List view (default):
 *   A single flat list of all artifacts. Current-turn files appear first
 *   with a ✨ "本轮" badge; history files follow without grouping headers.
 *
 * State 2 – Preview view:
 *   Full-bleed preview of the selected file with a back button in the
 *   header to return to the list. This mirrors the drawer's ArtifactPanel
 *   / ArtifactFileDetail two-state pattern so the two surfaces feel
 *   consistent.
 */
export function ArtifactInlinePreviewEmbedded({
  threadId,
  currentTurnEntries = [],
  runBlocked,
  runSettled,
  isLoading,
}: {
  threadId: string;
  currentTurnEntries?: DiffEntry[];
  runBlocked?: boolean;
  runSettled?: boolean;
  isLoading?: boolean;
}) {
  const {
    artifacts,
    selectedArtifact: externalSelected,
    select,
  } = useArtifacts();
  const { t } = useI18n();
  const streamdownPlugins = useStreamdownPlugins();

  const currentTurnRefs = useMemo(() => {
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const entry of currentTurnEntries) {
      const ref = normalizeWorkspaceArtifactRef(entry.path, threadId);
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
    return refs;
  }, [currentTurnEntries, threadId]);

  const currentTurnSet = useMemo(
    () => new Set(currentTurnRefs),
    [currentTurnRefs],
  );

  // Single flat list: current-turn first (in their natural order), then history.
  const allFiles = useMemo(() => {
    const cur: string[] = [];
    const hist: string[] = [];
    for (const f of artifacts ?? []) {
      if (currentTurnSet.has(f)) cur.push(f);
      else hist.push(f);
    }
    return [...cur, ...hist];
  }, [artifacts, currentTurnSet]);

  // Preview state: which file is being viewed full-screen. `null` = list view.
  const [previewing, setPreviewing] = useState<string | null>(null);

  // When an external selection arrives (e.g. clicking a filename in chat),
  // jump straight to the preview view for that file.
  useEffect(() => {
    if (externalSelected && allFiles.includes(externalSelected)) {
      setPreviewing(externalSelected);
      // Also sync the shared context so the drawer stays in sync.
      select(externalSelected);
    }
  }, [externalSelected, allFiles, select]);

  const handleSelect = useCallback(
    (path: string) => {
      setPreviewing(path);
      select(path);
    },
    [select],
  );

  const handleBack = useCallback(() => {
    setPreviewing(null);
  }, []);

  if (allFiles.length === 0) {
    const detail = runBlocked
      ? t.streaming.blockedOnUser
      : isLoading
        ? t.agentWorkbenchPanel.agentStatusRunning
        : runSettled
          ? t.livePreview.emptyHint
          : t.agentWorkbenchPanel.agentStatusPending;
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-xs flex-col items-center text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border-subtle bg-muted/45">
            <PackageIcon className="size-4 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {t.conversation.noPreviewArtifacts}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        </div>
      </div>
    );
  }

  // ── Preview view ──
  if (previewing) {
    return (
      <PreviewPane
        filepath={previewing}
        threadId={threadId}
        streamdownPlugins={streamdownPlugins}
        onBack={handleBack}
      />
    );
  }

  // ── List view ──
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {allFiles.map((f) => (
          <FileListRow
            key={f}
            filepath={f}
            isCurrentTurn={currentTurnSet.has(f)}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── List row ─────────────────────── */

function FileListRow({
  filepath,
  isCurrentTurn = false,
  onSelect,
}: {
  filepath: string;
  isCurrentTurn?: boolean;
  onSelect: (path: string) => void;
}) {
  const { locale } = useI18n();
  const displayPath = artifactDisplayPath(filepath);
  const name = getFileName(displayPath);
  return (
    <button
      type="button"
      onClick={() => onSelect(filepath)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {getFileIcon(displayPath, "size-3.5")}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
        {name}
      </span>
      {isCurrentTurn && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
          <SparklesIcon className="size-2.5" aria-hidden="true" />
          {workbenchArtifactsCopy(locale).currentTurn}
        </span>
      )}
    </button>
  );
}

/* ─────────────────────── Preview pane (full-screen) ─────────────────────── */

export function PreviewPane({
  filepath,
  threadId,
  streamdownPlugins,
  onBack,
}: {
  filepath: string;
  threadId: string;
  streamdownPlugins: Pick<StreamdownProps, "remarkPlugins" | "rehypePlugins">;
  onBack: () => void;
}) {
  const { t, locale } = useI18n();
  const displayPath = artifactDisplayPath(filepath);
  const isWriteFile = filepath.startsWith("write-file:");
  const { content, url, isLoading, refetch } = useArtifactContent({
    filepath,
    threadId,
    enabled: !isWriteFile,
  });
  const effectiveContent = isWriteFile ? "" : (content ?? "");

  const { isCodeFile, language: lang } = checkCodeFile(displayPath);
  const isHtml = lang === "html";
  const isMarkdown = lang === "markdown";
  const officeKind = officeArtifactKind(displayPath);
  const codeTruncated = effectiveContent.length > CODE_PREVIEW_LIMIT;
  const codeText = codeTruncated
    ? effectiveContent.slice(0, CODE_PREVIEW_LIMIT)
    : effectiveContent;

  return (
    <div className="flex min-h-0 size-full flex-col">
      {/* Header with back button */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t.common.back}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="flex size-5 shrink-0 items-center justify-center">
          {getFileIcon(displayPath, "size-3")}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {getFileName(displayPath)}
        </span>
        {lang && (
          <span className="shrink-0 text-xs text-muted-foreground uppercase">
            {lang}
          </span>
        )}
        <a
          href={urlOfArtifact({ filepath, threadId, download: true })}
          target="_blank"
          rel="noopener noreferrer"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t.common.download}
          title={t.common.download}
        >
          <DownloadIcon className="size-3" aria-hidden="true" />
        </a>
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-xs text-muted-foreground">
            {t.common.loading}…
          </div>
        )}
        {officeKind ? (
          <OfficePreview
            displayPath={displayPath}
            filepath={filepath}
            isMock={false}
            kind={officeKind}
            threadId={threadId}
          />
        ) : isMarkdown ? (
          <div className="size-full overflow-auto px-4 py-3">
            <Suspense
              fallback={
                <div className="size-full whitespace-pre-wrap break-words py-2 text-sm text-muted-foreground">
                  {effectiveContent}
                </div>
              }
            >
              <LazyStreamdown
                className="size-full"
                {...streamdownPlugins}
                components={{ a: ArtifactLink }}
              >
                {effectiveContent}
              </LazyStreamdown>
            </Suspense>
          </div>
        ) : isHtml ? (
          <HtmlPreview
            artifactRef={filepath}
            content={effectiveContent}
            filepath={displayPath}
            onSaved={() => void refetch()}
            threadId={threadId}
            url={url}
          />
        ) : isCodeFile ? (
          <div className="flex size-full min-h-0 flex-col">
            {codeTruncated && (
              <p className="shrink-0 border-b border-border-subtle bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                {workbenchArtifactsCopy(locale).previewTruncated}
              </p>
            )}
            <Suspense
              fallback={
                <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-sm text-muted-foreground">
                  {codeText}
                </pre>
              }
            >
              <LazyCodeEditor
                className="min-h-0 flex-1 resize-none rounded-none border-none"
                value={codeText}
                readonly
                syntaxPath={displayPath}
                threadId={threadId}
              />
            </Suspense>
          </div>
        ) : (
          <div className="flex size-full items-center justify-center p-4 text-xs text-muted-foreground">
            {workbenchArtifactsCopy(locale).previewUnsupported}
          </div>
        )}
      </div>
    </div>
  );
}
