import { HistoryIcon, LoaderIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listArtifactRevisions,
  readArtifactRevision,
  type ArtifactRevision,
  type ArtifactRevisionContent,
} from "@/core/artifacts/revisions";
import {
  ArtifactSaveError,
  restoreWorkspaceOutputRevision,
} from "@/core/artifacts/save";

const DiffViewer = lazy(() =>
  import("@/components/workspace/diff-viewer").then((module) => ({
    default: module.DiffViewer,
  })),
);

export function ArtifactRevisionHistory({
  filepath,
  threadId,
  currentContent,
  disabled,
  onRestored,
  onBusyChange,
}: {
  filepath: string;
  threadId: string;
  currentContent: string;
  disabled?: boolean;
  onRestored: (content: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<ArtifactRevision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [revision, setRevision] = useState<ArtifactRevisionContent | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);
  const pageRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setVersions([]);
    setSelected("");
    setRevision(null);
    setCursor(null);
    setError(null);
    setConflict(false);
    setLoading(true);
    void listArtifactRevisions({
      filepath,
      threadId,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setVersions(page.revisions);
        setCursor(page.next_cursor);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("版本历史加载失败，请重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      pageRequest.current?.abort();
    };
  }, [open, filepath, threadId, reload]);

  useEffect(() => {
    setRevision(null);
    setReading(false);
    if (!open || !selected) return;
    const controller = new AbortController();
    setReading(true);
    void readArtifactRevision({
      filepath,
      threadId,
      revisionId: selected,
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setRevision(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("此版本暂时无法读取，请重试或选择其他版本。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false);
      });
    return () => controller.abort();
  }, [open, filepath, threadId, selected, reload]);

  async function loadMore() {
    if (!cursor || loading) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await listArtifactRevisions({
        filepath,
        threadId,
        before: cursor,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setVersions((previous) => [...previous, ...page.revisions]);
        setCursor(page.next_cursor);
      }
    } catch {
      if (!controller.signal.aborted) setError("较早版本加载失败，请重试。");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function restore() {
    if (!revision || savingRef.current || conflict || disabled) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      await restoreWorkspaceOutputRevision({
        filepath,
        threadId,
        revisionId: revision.revision_id,
        expectedContent: currentContent,
      });
      onRestored(revision.content);
      setOpen(false);
    } catch (failure) {
      const changed =
        failure instanceof ArtifactSaveError && failure.status === 409;
      setConflict(changed);
      setError(
        changed
          ? "文件或历史版本已变化，当前内容未覆盖。关闭后重新加载页面，再进行比较。"
          : "恢复失败，当前内容未覆盖，请重试。",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!savingRef.current) setOpen(next);
      }}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <HistoryIcon className="size-3" />
        版本历史
      </Button>
      {open && (
        <DialogContent
          className="flex h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-5xl"
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
            <DialogDescription>
              选择旧版本，与当前页面比较。恢复前会保存当前版本，之后仍可找回。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 text-sm text-destructive"
            >
              {error}
              {!saving && !conflict && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReload((value) => value + 1)}
                >
                  重试
                </Button>
              )}
            </div>
          )}
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-3 sm:grid-cols-[180px_1fr] sm:grid-rows-1">
            <div
              className="max-h-32 overflow-auto sm:max-h-none"
              aria-label="保存的版本"
            >
              {versions.map((version) => (
                <button
                  key={version.revision_id}
                  type="button"
                  aria-pressed={selected === version.revision_id}
                  disabled={saving}
                  className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-xs ${selected === version.revision_id ? "border-primary bg-accent" : "border-transparent hover:bg-accent"}`}
                  onClick={() => {
                    if (!conflict) setError(null);
                    setSelected(version.revision_id);
                  }}
                >
                  <span className="block">
                    {new Date(version.created_at * 1000).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    {Math.max(1, Math.ceil(version.bytes / 1024))} KB
                  </span>
                </button>
              ))}
              {loading && (
                <p role="status" className="p-2 text-sm text-muted-foreground">
                  加载中…
                </p>
              )}
              {!loading && !versions.length && !error && (
                <p className="p-2 text-sm text-muted-foreground">
                  暂无保存的旧版本
                </p>
              )}
              {cursor && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || saving}
                  onClick={() => void loadMore()}
                >
                  更早版本
                </Button>
              )}
            </div>
            <div className="flex min-h-0 min-w-0 flex-col rounded-lg border">
              <p className="border-b px-3 py-2 text-xs text-muted-foreground">
                删除部分为当前内容，新增部分为选中的旧版本
              </p>
              {reading ? (
                <p role="status" className="p-4 text-sm">
                  正在读取版本…
                </p>
              ) : revision ? (
                <Suspense fallback={<p className="p-4 text-sm">正在比较…</p>}>
                  <DiffViewer
                    className="min-h-0 flex-1"
                    oldValue={currentContent}
                    newValue={revision.content}
                    readOnly
                  />
                </Suspense>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  选择一个版本查看变化
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              保留当前版本
            </Button>
            <Button
              disabled={
                disabled ||
                saving ||
                reading ||
                !revision ||
                conflict ||
                revision.content === currentContent
              }
              onClick={() => void restore()}
            >
              {saving && <LoaderIcon className="size-4 animate-spin" />}
              恢复此版本
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
