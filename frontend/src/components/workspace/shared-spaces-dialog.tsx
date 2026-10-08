import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { listWorkspaces, type Workspace } from "@/core/workspace/api";
import {
  attachSharedSpace,
  detachSharedSpace,
  listSharedSpaces,
  syncSharedSpace,
  type SharedSpace,
  type SyncPreview,
} from "@/core/workspace/shared-spaces";
import { MountPointDialog } from "./mount-point-dialog";
import { ExecutionNodesDialog } from "./execution-nodes-dialog";

export function SharedSpacesDialog({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const [spaces, setSpaces] = useState<SharedSpace[]>([]);
  const [available, setAvailable] = useState<Workspace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mount, setMount] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [preview, setPreview] = useState<{
    id: string;
    plan: SyncPreview;
  } | null>(null);
  const refresh = async () => {
    const [attached, all] = await Promise.all([
      listSharedSpaces(threadId),
      listWorkspaces(),
    ]);
    setSpaces(attached.spaces);
    setAvailable(all);
  };
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setError("");
    setSpaces([]);
    setAvailable([]);
    setBusy(true);
    void Promise.all([listSharedSpaces(threadId), listWorkspaces()])
      .then(([attached, all]) => {
        if (!cancelled) {
          setSpaces(attached.spaces);
          setAvailable(all);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) onOpenChange(value);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {zh ? "共享空间与同步" : "Shared spaces & sync"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "保留当前项目目录，追加共享目录作为同步目标。先预览，再双向同步；不传播删除，冲突文件不会被覆盖。"
                : "Keep this project's directory and attach sync destinations. Preview before two-way sync. Deletions are not propagated; conflicts are not overwritten."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {zh
              ? "两边目录都须在当前 Echo 执行设备上可访问。直接选择共享目录作为项目时，无须这一步复制同步。"
              : "Both directories must be accessible on the connected Echo runtime. Projects opened directly on a shared mount need no copy sync."}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {spaces.map((space) => (
            <div key={space.id} className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">{space.name}</div>
              <div className="break-all text-xs text-muted-foreground">
                {space.path || space.detail}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !space.ready}
                  onClick={() =>
                    void run(async () => {
                      setPreview({
                        id: space.id,
                        plan: await syncSharedSpace(threadId, space.id),
                      });
                    })
                  }
                >
                  {zh ? "预览同步" : "Preview sync"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await detachSharedSpace(threadId, space.id);
                      setPreview(null);
                      await refresh();
                    })
                  }
                >
                  {zh ? "移除关联" : "Detach"}
                </Button>
              </div>
            </div>
          ))}
          {preview && (
            <div className="space-y-2 rounded-md border p-3" aria-live="polite">
              <p className="text-sm">
                {preview.plan.applied
                  ? zh
                    ? "本次同步完成"
                    : "Sync completed"
                  : zh
                    ? "待同步差异"
                    : "Pending changes"}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {preview.plan.local_path} ↔ {preview.plan.shared_path}
              </p>
              <ul className="max-h-40 overflow-y-auto text-xs">
                {preview.plan.actions.map((item) => (
                  <li key={item.path}>
                    {item.direction === "push"
                      ? zh
                        ? "本地 → 共享"
                        : "Local → shared"
                      : zh
                        ? "共享 → 本地"
                        : "Shared → local"}
                    : {item.path}
                  </li>
                ))}
                {preview.plan.conflicts.map((path) => (
                  <li key={path} className="text-amber-600">
                    {zh ? "冲突，已保留" : "Conflict, preserved"}: {path}
                  </li>
                ))}
              </ul>
              {preview.plan.actions.length === 0 && (
                <p className="text-xs">
                  {zh
                    ? "没有可自动同步的改动"
                    : "No changes eligible for automatic sync"}
                </p>
              )}
              {preview.plan.skipped.length > 0 && (
                <details className="text-xs">
                  <summary>
                    {zh
                      ? "已排除的依赖、配置和链接文件"
                      : "Excluded dependencies, configuration and links"}{" "}
                    ({preview.plan.skipped.length})
                  </summary>
                  {preview.plan.skipped.map((path) => (
                    <div key={path}>{path}</div>
                  ))}
                </details>
              )}
              {!preview.plan.applied && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setPreview({
                        id: preview.id,
                        plan: await syncSharedSpace(
                          threadId,
                          preview.id,
                          preview.plan.token,
                        ),
                      });
                    })
                  }
                >
                  {zh ? "同步无冲突文件" : "Sync non-conflicting files"}
                </Button>
              )}
            </div>
          )}
          <label className="space-y-1 text-sm">
            {zh ? "追加共享空间" : "Attach shared space"}
            <select
              className="w-full rounded-md border bg-background p-2"
              value=""
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                if (id)
                  void run(async () => {
                    await attachSharedSpace(threadId, id);
                    setPreview(null);
                    await refresh();
                  });
              }}
            >
              <option value="">
                {zh ? "选择已接入的目录…" : "Choose a connected directory…"}
              </option>
              {available
                .filter((ws) => !spaces.some((item) => item.id === ws.id))
                .map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setMount(true)}
          >
            {zh ? "接入共享目录" : "Connect shared directory"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setExecutionOpen(true)}>
            {zh ? "在其他设备执行任务" : "Run a task on another device"}
          </Button>
        </DialogContent>
      </Dialog>
      <MountPointDialog
        open={mount}
        onOpenChange={setMount}
        defaultMountType="local"
        onCreated={() => void run(refresh)}
      />
      <ExecutionNodesDialog open={executionOpen} onOpenChange={setExecutionOpen} spaces={available} />
    </>
  );
}
