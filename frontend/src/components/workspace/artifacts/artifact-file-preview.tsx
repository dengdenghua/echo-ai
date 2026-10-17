import {
  LoaderIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { StreamdownProps } from "streamdown";

import { Button } from "@/components/ui/button";
import {
  createArtifactProposal,
  decideArtifactProposal,
} from "@/core/artifacts/proposals";
import {
  ArtifactSaveError,
  canSaveWorkspaceOutput,
  restoreWorkspaceOutputRevision,
  saveWorkspaceOutputContent,
} from "@/core/artifacts/save";
import { useI18n } from "@/core/i18n/hooks";
import { dispatchQuickReply } from "@/core/messages/quick-reply";
import { isObjectLike } from "@/core/utils/guards";

import { ArtifactLink } from "../citations/artifact-link";
import { useThread } from "../messages/context";

import { ArtifactProposalReview } from "./artifact-proposal-review";
import { ArtifactRevisionHistory } from "./artifact-revision-history";
import {
  buildArtifactEditPrompt,
  buildInspectableHtml,
  replaceHtmlBodyContent,
} from "./inspect-html";
import { InspectOverlay } from "./inspect-overlay";

const LazyStreamdown = lazy(
  () => import("@/components/ai-elements/streamdown-host"),
);

export function ArtifactFilePreview({
  artifactRef,
  content,
  filepath,
  language,
  streamdownPlugins,
  url,
  threadId,
  onSaved,
  onReload,
  onEditProtectionChange,
}: {
  artifactRef?: string;
  content: string;
  filepath: string;
  language: string;
  streamdownPlugins: Pick<StreamdownProps, "remarkPlugins" | "rehypePlugins">;
  url?: string;
  threadId?: string;
  onSaved?: (content: string) => void;
  onReload?: () => void;
  onEditProtectionChange?: (protectedFromUnload: boolean) => void;
}) {
  if (language === "markdown") {
    return (
      <div className="size-full px-4">
        <Suspense
          fallback={
            <div className="size-full whitespace-pre-wrap break-words py-4">
              {content ?? ""}
            </div>
          }
        >
          <LazyStreamdown
            className="size-full"
            {...streamdownPlugins}
            components={{ a: ArtifactLink }}
          >
            {content ?? ""}
          </LazyStreamdown>
        </Suspense>
      </div>
    );
  }
  if (language === "html") {
    return (
      <HtmlPreview
        artifactRef={artifactRef}
        content={content}
        filepath={filepath}
        url={url}
        threadId={threadId}
        onSaved={onSaved}
        onReload={onReload}
        onEditProtectionChange={onEditProtectionChange}
      />
    );
  }
  return null;
}

function createHtmlBridgeToken(): string {
  const values = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36)).join("-");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function HtmlPreview({
  artifactRef,
  content,
  filepath,
  url,
  threadId,
  onSaved,
  onReload,
  onEditProtectionChange,
}: {
  artifactRef?: string;
  content: string;
  filepath: string;
  url?: string;
  threadId?: string;
  onSaved?: (content: string) => void;
  onReload?: () => void;
  onEditProtectionChange?: (protectedFromUnload: boolean) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [inspectionMode, setInspectionMode] = useState(!url);
  const [localContent, setLocalContent] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeRevision, setBridgeRevision] = useState(0);
  const [humanEditing, setHumanEditing] = useState(false);
  const [humanDirty, setHumanDirty] = useState(false);
  const [humanSaving, setHumanSaving] = useState(false);
  const [pendingHumanEdit, setPendingHumanEdit] = useState(false);
  const [humanConflict, setHumanConflict] = useState<string | null>(null);
  const [undoRevision, setUndoRevision] = useState<{
    revisionId: string;
    expectedContent: string;
    restoredContent: string;
  } | null>(null);
  const humanSavingRef = useRef(false);
  const proposalRequestRef = useRef<AbortController | null>(null);
  const [proposalRefresh, setProposalRefresh] = useState(0);
  useEffect(
    () => () => proposalRequestRef.current?.abort(),
    [filepath, threadId],
  );
  const humanEditActiveRef = useRef(false);
  humanEditActiveRef.current = humanEditing || pendingHumanEdit;
  const { t } = useI18n();
  const {
    thread: { isLoading },
  } = useThread();

  const effectiveContent = localContent ?? content;
  const bridgeToken = useMemo(() => {
    // Reading the identity inputs is intentional: a fresh token invalidates
    // any message source captured before the preview or rendered HTML changed.
    void effectiveContent;
    void filepath;
    void url;
    return createHtmlBridgeToken();
  }, [effectiveContent, filepath, url]);
  const canInspect = Boolean(effectiveContent);
  const canHumanEdit = Boolean(
    artifactRef && threadId && canSaveWorkspaceOutput(artifactRef),
  );

  useEffect(() => {
    setInspectionMode(!url);
    setBridgeReady(false);
    setHumanEditing(false);
    setHumanDirty(false);
    setHumanSaving(false);
    humanSavingRef.current = false;
    setPendingHumanEdit(false);
    setHumanConflict(null);
    setUndoRevision(null);
  }, [filepath, url]);

  useEffect(() => {
    onEditProtectionChange?.(humanDirty || humanSaving);
  }, [humanDirty, humanSaving, onEditProtectionChange]);

  useEffect(() => {
    if (!humanEditActiveRef.current) setLocalContent(null);
  }, [content]);

  // Prepend the inspect script so it runs before any inline scripts in the
  // artifact. Wrapping in a <script> at document start keeps the user's
  // original markup untouched if it already declares <html>/<head>.
  const srcDoc = useMemo(() => {
    if (!effectiveContent) return undefined;
    return buildInspectableHtml(effectiveContent, url, bridgeToken);
  }, [bridgeToken, effectiveContent, url]);

  const postBridgeMessage = useCallback(
    (type: string) => {
      iframeRef.current?.contentWindow?.postMessage(
        { type, echoBridgeToken: bridgeToken },
        "*",
      );
    },
    [bridgeToken],
  );

  useEffect(() => {
    setBridgeReady(false);
  }, [srcDoc]);

  const persistHumanEdit = useCallback(
    async (bodyHtml: string) => {
      if (!artifactRef || !threadId || humanSavingRef.current) return;
      const updated = replaceHtmlBodyContent(effectiveContent, bodyHtml);
      humanSavingRef.current = true;
      setHumanSaving(true);
      try {
        const result = await saveWorkspaceOutputContent({
          filepath: artifactRef,
          threadId,
          content: updated,
          expectedContent: effectiveContent,
        });
        setUndoRevision(
          result.revision_id
            ? {
                revisionId: result.revision_id,
                expectedContent: updated,
                restoredContent: effectiveContent,
              }
            : null,
        );
        setLocalContent(updated);
        postBridgeMessage("echo:edit:commit");
        setHumanEditing(false);
        setHumanDirty(false);
        setPendingHumanEdit(false);
        setHumanConflict(null);
        toast.success(t.livePreview.humanSaved);
        onSaved?.(updated);
      } catch (error) {
        if (error instanceof ArtifactSaveError && error.status === 409) {
          setHumanConflict(error.message);
        }
        toast.error(
          error instanceof Error ? error.message : t.codeEditor.fileSaveFailed,
        );
      } finally {
        humanSavingRef.current = false;
        setHumanSaving(false);
      }
    },
    [
      artifactRef,
      effectiveContent,
      onSaved,
      postBridgeMessage,
      t.codeEditor.fileSaveFailed,
      t.livePreview.humanSaved,
      threadId,
    ],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!isObjectLike(data)) return;
      if (data.echoBridgeToken !== bridgeToken) return;
      if (data.type === "echo:inspect:ready") {
        setBridgeReady(true);
        if (pendingHumanEdit) {
          postBridgeMessage("echo:edit:enable");
          setPendingHumanEdit(false);
        }
      } else if (data.type === "echo:edit:state") {
        setHumanEditing(data.active === true);
        setHumanDirty(data.dirty === true);
      } else if (
        data.type === "echo:edit:content" &&
        typeof data.bodyHtml === "string"
      ) {
        void persistHumanEdit(data.bodyHtml);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridgeToken, pendingHumanEdit, persistHumanEdit, postBridgeMessage]);

  useEffect(() => {
    if (!humanDirty) return;
    const protectUnsavedEdit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedEdit);
    return () => window.removeEventListener("beforeunload", protectUnsavedEdit);
  }, [humanDirty]);

  const beginHumanEdit = useCallback(() => {
    if (!canHumanEdit || isLoading) return;
    setLocalContent(effectiveContent);
    if (!inspectionMode || !bridgeReady) {
      setPendingHumanEdit(true);
      setBridgeReady(false);
      if (inspectionMode) setBridgeRevision((value) => value + 1);
      setInspectionMode(true);
      return;
    }
    postBridgeMessage("echo:edit:enable");
  }, [
    bridgeReady,
    canHumanEdit,
    effectiveContent,
    inspectionMode,
    isLoading,
    postBridgeMessage,
  ]);

  const cancelHumanEdit = useCallback(() => {
    postBridgeMessage("echo:edit:cancel");
    setHumanEditing(false);
    setHumanDirty(false);
    setPendingHumanEdit(false);
    setHumanConflict(null);
    setLocalContent(null);
  }, [postBridgeMessage]);

  const reloadAfterConflict = useCallback(() => {
    postBridgeMessage("echo:edit:cancel");
    setHumanEditing(false);
    setHumanDirty(false);
    setPendingHumanEdit(false);
    setHumanConflict(null);
    setLocalContent(null);
    setBridgeReady(false);
    setBridgeRevision((value) => value + 1);
    onReload?.();
  }, [onReload, postBridgeMessage]);

  const undoLastHumanSave = useCallback(async () => {
    if (!artifactRef || !threadId || !undoRevision || humanSavingRef.current)
      return;
    humanSavingRef.current = true;
    setHumanSaving(true);
    try {
      await restoreWorkspaceOutputRevision({
        filepath: artifactRef,
        threadId,
        revisionId: undoRevision.revisionId,
        expectedContent: undoRevision.expectedContent,
      });
      setLocalContent(undoRevision.restoredContent);
      setUndoRevision(null);
      toast.success(t.livePreview.humanRestored);
      onSaved?.(undoRevision.restoredContent);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.codeEditor.fileSaveFailed,
      );
    } finally {
      humanSavingRef.current = false;
      setHumanSaving(false);
    }
  }, [artifactRef, onSaved, t, threadId, undoRevision]);

  const requestAiEdit = useCallback(
    async (
      selection: {
        selector: string;
        tagName: string;
        outerHTML: string;
        textContent: string;
      },
      instruction: string,
    ) => {
      if (!artifactRef || !threadId || humanSavingRef.current) return false;
      const controller = new AbortController();
      proposalRequestRef.current = controller;
      humanSavingRef.current = true;
      setHumanSaving(true);
      try {
        const proposal = await createArtifactProposal({
          filepath: artifactRef,
          threadId,
          expectedContent: effectiveContent ?? "",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return false;
        setProposalRefresh((value) => value + 1);
        if (!proposal.candidate_path) throw new Error("工作副本创建失败。");
        const prompt = buildArtifactEditPrompt(
          proposal.candidate_path,
          selection,
          instruction,
          { proposalId: proposal.proposal_id },
        );
        const accepted = dispatchQuickReply({ text: prompt, threadId });
        if (accepted) {
          toast.success(t.livePreview.aiEditQueued);
        } else {
          await decideArtifactProposal({
            filepath: artifactRef,
            threadId,
            proposalId: proposal.proposal_id,
            action: "reject",
          });
          toast.error(t.livePreview.aiEditUnavailable);
        }
        return accepted;
      } catch (error) {
        if (!controller.signal.aborted)
          toast.error(
            error instanceof Error
              ? error.message
              : t.livePreview.aiEditUnavailable,
          );
        return false;
      } finally {
        humanSavingRef.current = false;
        setHumanSaving(false);
      }
    },
    [
      artifactRef,
      effectiveContent,
      t.livePreview.aiEditQueued,
      t.livePreview.aiEditUnavailable,
      threadId,
    ],
  );

  return (
    <div className="relative size-full">
      <InspectOverlay
        bridgeToken={bridgeToken}
        enabled={canInspect && !humanEditing}
        filepath={filepath}
        iframeRef={iframeRef}
        busy={isLoading || humanSaving}
        onPrepareInspect={
          url && !inspectionMode ? () => setInspectionMode(true) : undefined
        }
        onRequestAiEdit={canHumanEdit ? requestAiEdit : undefined}
      >
        <iframe
          key={`${inspectionMode ? "inspect" : "live"}-${bridgeRevision}`}
          className="size-full"
          ref={iframeRef}
          sandbox={
            inspectionMode ? "allow-scripts" : "allow-scripts allow-forms"
          }
          title="Artifact preview"
          {...(inspectionMode && srcDoc
            ? { srcDoc }
            : url
              ? { src: url }
              : srcDoc
                ? { srcDoc }
                : {})}
        />
      </InspectOverlay>
      {canHumanEdit && (
        <div className="pointer-events-none absolute top-2 left-2 z-20 flex items-center gap-1.5">
          {humanEditing ? (
            <>
              <span className="rounded-md bg-background/95 px-2 py-1 text-xs font-medium shadow-md backdrop-blur">
                {humanConflict
                  ? t.livePreview.humanConflict
                  : humanDirty
                    ? t.livePreview.humanUnsaved
                    : t.livePreview.humanEditing}
              </span>
              <Button
                aria-label={t.livePreview.humanSave}
                className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
                disabled={humanSaving || isLoading || Boolean(humanConflict)}
                onClick={() => postBridgeMessage("echo:edit:request-save")}
                size="sm"
                type="button"
              >
                {humanSaving ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <SaveIcon className="size-3" />
                )}
                {t.livePreview.humanSave}
              </Button>
              {humanConflict && (
                <Button
                  className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
                  disabled={humanSaving || isLoading}
                  onClick={reloadAfterConflict}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <RefreshCwIcon className="size-3" />
                  {t.livePreview.humanReloadLatest}
                </Button>
              )}
              <Button
                aria-label={t.livePreview.humanCancel}
                className="pointer-events-auto size-7 shadow-md"
                disabled={humanSaving}
                onClick={cancelHumanEdit}
                size="icon-sm"
                type="button"
                variant="secondary"
              >
                <XIcon className="size-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
                disabled={isLoading || pendingHumanEdit || humanSaving}
                onClick={beginHumanEdit}
                size="sm"
                type="button"
                variant="secondary"
              >
                {pendingHumanEdit ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <PencilIcon className="size-3" />
                )}
                {t.livePreview.humanEdit}
              </Button>
              {undoRevision && (
                <Button
                  className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
                  disabled={isLoading || humanSaving}
                  onClick={() => void undoLastHumanSave()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {humanSaving ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <Undo2Icon className="size-3" />
                  )}
                  {t.livePreview.humanUndo}
                </Button>
              )}
              {artifactRef && threadId && (
                <ArtifactProposalReview
                  key={`proposals:${threadId}:${artifactRef}`}
                  filepath={artifactRef}
                  threadId={threadId}
                  running={isLoading}
                  refreshKey={proposalRefresh}
                  onReload={onReload}
                  disabled={humanSaving || pendingHumanEdit}
                  onBusyChange={(busy) => {
                    humanSavingRef.current = busy;
                    setHumanSaving(busy);
                  }}
                  onApplied={(applied) => {
                    setLocalContent(applied);
                    setUndoRevision(null);
                    setBridgeReady(false);
                    setBridgeRevision((value) => value + 1);
                    onSaved?.(applied);
                    toast.success(t.livePreview.humanSaved);
                  }}
                />
              )}
              {artifactRef && threadId && (
                <ArtifactRevisionHistory
                  key={`${threadId}:${artifactRef}`}
                  filepath={artifactRef}
                  threadId={threadId}
                  currentContent={effectiveContent ?? ""}
                  disabled={isLoading || humanSaving || pendingHumanEdit}
                  onBusyChange={(busy) => {
                    humanSavingRef.current = busy;
                    setHumanSaving(busy);
                  }}
                  onRestored={(restored) => {
                    setLocalContent(restored);
                    setUndoRevision(null);
                    setBridgeReady(false);
                    setBridgeRevision((value) => value + 1);
                    onSaved?.(restored);
                    toast.success(t.livePreview.humanRestored);
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
