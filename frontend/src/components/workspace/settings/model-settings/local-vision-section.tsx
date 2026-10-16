import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  disableNASModel,
  downloadNASModel,
  enableNASModel,
  listNASModels,
  startNASService,
  type NASModel,
} from "@/core/storage/api";

import { SettingsSection } from "../settings-section";

export function LocalVisionSection() {
  const [model, setModel] = useState<NASModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceState, setServiceState] = useState<
    "checking" | "available" | "unavailable"
  >("checking");

  const presentError = useCallback((error: unknown) => {
    setServiceState("unavailable");
    const raw = error instanceof Error ? error.message : String(error);
    if (/403|admin\/operator role required/i.test(raw)) {
      setMessage("当前账号无权管理本地图片理解，请联系管理员。");
      return;
    }
    setMessage("本地图片理解服务暂时不可用，请稍后重试。");
  }, []);

  const refresh = useCallback(async () => {
    setServiceState("checking");
    setMessage(null);
    try {
      const start = await startNASService();
      if (!start.ok) {
        setModel(null);
        setServiceState("unavailable");
        if (start.status === "not_found") {
          setMessage(
            "本地图片理解服务尚未安装。安装 echo-storage 后可在这里下载并启用模型。",
          );
        } else if (start.status === "started") {
          setMessage("本地图片理解服务正在启动，请稍后重新检查。");
        } else {
          setMessage("本地图片理解服务暂时不可用，请稍后重新检查。");
        }
        return;
      }
      const models = await listNASModels();
      setModel(
        models.find((item) => item.model_id === "vision-default") ?? null,
      );
      setServiceState("available");
    } catch (error) {
      presentError(error);
    }
  }, [presentError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<NASModel>, pending: string) => {
    setBusy(true);
    setMessage(pending);
    try {
      const next = await action();
      setModel(next);
      if (next.status === "loading") {
        const timer = window.setInterval(() => {
          void listNASModels()
            .then((models) => {
              const current = models.find(
                (item) => item.model_id === "vision-default",
              );
              if (current) setModel(current);
              if (current && current.status !== "loading") {
                window.clearInterval(timer);
                setBusy(false);
                setMessage(current.notes);
              }
            })
            .catch(() => undefined);
        }, 2000);
        window.setTimeout(
          () => {
            window.clearInterval(timer);
            setBusy(false);
          },
          15 * 60 * 1000,
        );
      } else {
        setBusy(false);
        setMessage(next.notes);
      }
    } catch (error) {
      setBusy(false);
      presentError(error);
    }
  };

  const downloaded = model?.provider === "local" && Boolean(model.endpoint);
  const enabled = model?.status === "running";
  const serviceUnavailable = serviceState === "unavailable";

  return (
    <SettingsSection
      title="本地图片理解（CLIP）"
      description="用于图片、视频关键帧的语义检索。模型下载到本机，不上传原始文件。"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span
              className={cn(
                "size-2 rounded-full",
                enabled ? "bg-success" : "bg-muted-foreground/40",
              )}
            />
            {enabled ? "已启用" : downloaded ? "已下载，未启用" : "尚未下载"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            sentence-transformers/clip-ViT-B-32 · 约 600MB
          </p>
          {message ? (
            <p
              role={message.includes("无权") ? "alert" : undefined}
              className={cn(
                "mt-1 text-xs",
                message.includes("无权")
                  ? "text-warning"
                  : "text-muted-foreground",
              )}
            >
              {message}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {serviceState === "checking" ? (
            <Button size="sm" variant="outline" disabled>
              检查中…
            </Button>
          ) : serviceUnavailable ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={busy || Boolean(message?.includes("无权"))}
            >
              重新检查
            </Button>
          ) : !downloaded ? (
            <Button
              size="sm"
              onClick={() =>
                void run(
                  () => downloadNASModel("vision-default"),
                  "正在下载模型…",
                )
              }
              disabled={busy || Boolean(message?.includes("无权"))}
            >
              {busy ? "下载中…" : "下载并启用"}
            </Button>
          ) : enabled ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void run(() => disableNASModel("vision-default"), "正在关闭…")
              }
              disabled={busy}
            >
              关闭
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() =>
                void run(() => enableNASModel("vision-default"), "正在启用…")
              }
              disabled={busy}
            >
              启用
            </Button>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
