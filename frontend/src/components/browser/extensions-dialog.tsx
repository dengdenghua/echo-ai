import {
  ExternalLinkIcon,
  FolderPlusIcon,
  PuzzleIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { BrowserExtensionInfo } from "@/types/electron";

/**
 * Real browser extensions of the desktop app: load an unpacked folder,
 * turn one on or off, remove it. Extensions run in browser tabs only.
 */
export function ExtensionsDialog({
  open,
  onOpenChange,
  onOpenStore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenStore: () => void;
}) {
  const api =
    typeof window === "undefined" ? undefined : window.echo?.extensions;
  const [extensions, setExtensions] = useState<BrowserExtensionInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  const refresh = useCallback(async () => {
    if (!api) return;
    const result = await api.list();
    if (result.ok) setExtensions(result.extensions);
    else setError(result.error || "无法读取扩展列表");
  }, [api]);

  useEffect(() => {
    if (!open) return;
    setError("");
    void refresh();
  }, [open, refresh]);

  const run = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (!result.ok && result.error) setError(result.error);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (extension: BrowserExtensionInfo) => {
    const ok = await confirm({
      title: "移除扩展",
      description: `从 Echo 中移除「${extension.name}」？扩展文件夹本身不会被删除。`,
    });
    if (ok && api) await run(() => api.remove(extension.id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>浏览器扩展</DialogTitle>
          <DialogDescription>
            扩展只在浏览器标签页中运行，无痕标签页不加载扩展。
          </DialogDescription>
        </DialogHeader>
        {!api ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            扩展需要在 Echo 桌面版中使用。
          </p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {extensions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-sm text-muted-foreground">
                还没有扩展
              </p>
            ) : (
              extensions.map((extension) => (
                <div
                  key={extension.id}
                  className="flex items-start gap-3 rounded-lg border border-border-subtle px-3 py-2.5"
                >
                  <PuzzleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium">
                        {extension.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {extension.version}
                      </span>
                    </div>
                    {extension.description ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {extension.description}
                      </p>
                    ) : null}
                    <p
                      className="truncate text-[11px] text-muted-foreground"
                      title={extension.path}
                    >
                      {extension.path}
                    </p>
                  </div>
                  <Switch
                    checked={extension.enabled}
                    disabled={busy}
                    aria-label={`${extension.enabled ? "停用" : "启用"} ${extension.name}`}
                    onCheckedChange={(enabled) =>
                      void run(() => api.setEnabled(extension.id, enabled))
                    }
                  />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`移除 ${extension.name}`}
                    onClick={() => void remove(extension)}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {api ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.installFromFolder();
                  return result.canceled ? { ok: true } : result;
                })
              }
            >
              <FolderPlusIcon className="size-4" />
              加载已解压的扩展…
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onOpenStore}>
            <ExternalLinkIcon className="size-4" />
            Chrome 应用店
          </Button>
        </div>
        {api ? (
          <p className="text-xs leading-5 text-muted-foreground">
            从应用店下载的扩展需要先解压成包含 manifest.json
            的文件夹再加载；部分扩展接口在 Echo 中不可用。
          </p>
        ) : null}
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
