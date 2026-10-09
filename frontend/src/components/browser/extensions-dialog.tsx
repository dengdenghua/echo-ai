import {
  DownloadIcon,
  ExternalLinkIcon,
  FolderPlusIcon,
  PuzzleIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { BrowserExtensionInfo } from "@/types/electron";

import {
  EXTENSION_STORE_HOME,
  EXTENSION_STORE_NAME,
  type ExtensionStore,
} from "./extension-links";

function sourceLabel(extension: BrowserExtensionInfo): string {
  return extension.source === "chrome" || extension.source === "edge"
    ? `来自 ${EXTENSION_STORE_NAME[extension.source]}`
    : extension.path;
}

/**
 * Real browser extensions of the desktop app: install from the Chrome Web
 * Store / Edge Add-ons or an unpacked folder, turn one on or off, remove
 * it. Extensions run in browser tabs only.
 */
export function ExtensionsDialog({
  open,
  onOpenChange,
  onOpenStore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenStore: (url: string) => void;
}) {
  const [storeLink, setStoreLink] = useState("");
  const api =
    typeof window === "undefined" ? undefined : window.echo?.extensions;
  const [extensions, setExtensions] = useState<BrowserExtensionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  const refresh = useCallback(async () => {
    if (!api) return;
    const result = await api.list();
    if (result.ok) setExtensions(result.extensions);
    else setError(result.error || "无法读取扩展列表");
    setLoaded(true);
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
    const fromStore =
      extension.source === "chrome" || extension.source === "edge";
    const ok = await confirm({
      title: "移除扩展",
      description: fromStore
        ? `从 Echo 中移除「${extension.name}」？`
        : `从 Echo 中移除「${extension.name}」？扩展文件夹本身不会被删除。`,
    });
    if (ok && api) await run(() => api.remove(extension.id));
  };

  const installFromStore = () =>
    void run(async () => {
      if (!api) return { ok: false };
      const result = await api.installFromStore(storeLink);
      if (result.ok) {
        setStoreLink("");
        toast.success(`已安装「${result.extension?.name ?? "扩展"}」`);
      }
      return result;
    });

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
                {loaded ? "还没有扩展" : "正在读取扩展…"}
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
                      {sourceLabel(extension)}
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
        {api ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (storeLink.trim()) installFromStore();
            }}
          >
            <Input
              value={storeLink}
              onChange={(event) => setStoreLink(event.target.value)}
              placeholder="粘贴应用店扩展链接或扩展 ID"
              aria-label="应用店扩展链接或扩展 ID"
              disabled={busy}
              className="h-9"
            />
            <Button type="submit" disabled={busy || !storeLink.trim()}>
              <DownloadIcon className="size-4" />
              安装
            </Button>
          </form>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {api ? (
            <Button
              variant="secondary"
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
          {(Object.keys(EXTENSION_STORE_HOME) as ExtensionStore[]).map(
            (store) => (
              <Button
                key={store}
                variant="ghost"
                onClick={() => onOpenStore(EXTENSION_STORE_HOME[store])}
              >
                <ExternalLinkIcon className="size-4" />
                {EXTENSION_STORE_NAME[store]}
              </Button>
            ),
          )}
        </div>
        {api ? (
          <p className="text-xs leading-5 text-muted-foreground">
            在应用店打开扩展详情页，点地址栏的“安装到
            Echo”，或复制链接粘贴到上面。部分扩展接口在 Echo 中不可用。
          </p>
        ) : null}
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
