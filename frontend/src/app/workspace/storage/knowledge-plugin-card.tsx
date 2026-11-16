import { useCallback, useEffect, useState } from "react";
import { DatabaseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { untypedApi } from "@/core/api/request";
import {
  hubChangeLifecycle,
  type HubLifecycleAction,
} from "@/core/plugins/api";
import { startNASService } from "@/core/storage/api";
import { serviceErrorMessage } from "@/core/utils/service-error";

interface KnowledgeStatus {
  up: boolean;
  installed: boolean;
  enabled: boolean;
  version?: string;
  installed_version?: string;
  error?: string | null;
}

export function KnowledgePluginCard({
  onChange,
}: {
  onChange: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(
        await untypedApi.get<KnowledgeStatus>("/api/storage/status", {
          reason: "knowledge plugin lifecycle status",
        }),
      );
    } catch (err) {
      setError(serviceErrorMessage(err));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const change = async (action: HubLifecycleAction | "start" | "upgrade") => {
    setBusy(true);
    setError("");
    try {
      if (action === "start") await startNASService();
      else if (action === "upgrade")
        await untypedApi.post(
          "/api/plugin-hub/plugins/knowledge_storage/upgrade",
          {
            reason: "upgrade built-in knowledge plugin without deleting data",
            body: {},
          },
        );
      else await hubChangeLifecycle("knowledge_storage", action);
      await refresh();
      await onChange();
    } catch (err) {
      setError(serviceErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const label = !status
    ? "正在检查"
    : !status.installed
      ? "未安装"
      : !status.enabled
        ? "已停用"
        : status.up
          ? "运行中"
          : "已停止";
  return (
    <section
      aria-label="知识库插件"
      className="shrink-0 border-b border-border px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DatabaseIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="text-sm font-medium">知识库</span>
        <span role="status" className="text-xs text-muted-foreground">
          {label}
          {status?.version ? ` · ${status.version}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {!status ? (
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              重试
            </Button>
          ) : !status.installed ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void change("install")}
            >
              安装并启用
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void change(status.enabled ? "disable" : "enable")
                }
              >
                {status.enabled ? "停用" : "启用"}
              </Button>
              {status.enabled && !status.up && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void change("start")}
                >
                  启动服务
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change("upgrade")}
              >
                更新组件
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change("uninstall")}
              >
                卸载并保留数据
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        首次启用仅在本机建立索引；请添加授权目录。停用不删除文件，重装可恢复原知识库。
      </p>
      {(error || status?.error) && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error || status?.error}
        </p>
      )}
    </section>
  );
}
