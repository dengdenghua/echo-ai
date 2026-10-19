import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/core/api/request";
import {
  parseCodeBuddyModels,
  parseCodeBuddyStatus,
} from "@/core/agents/codebuddy-status";
import { useI18n } from "@/core/i18n/hooks";
import { useCanManageWorkbenches } from "@/core/workbench/workbench-permissions";
import { useOptionalAuth } from "@/providers/AuthProvider";
import { CodeBuddyCredits } from "./codebuddy-credits";

export function CodeBuddyConnection() {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const client = useQueryClient();
  const canManage = useCanManageWorkbenches();
  const auth = useOptionalAuth();
  const principal = auth?.user?.actor_id || auth?.user?.user_id || "local";
  const status = useQuery({
    queryKey: ["codebuddy-settings-status", principal],
    queryFn: async ({ signal }) =>
      parseCodeBuddyStatus(
        await apiGet("/api/config/codebuddy/status", { signal }),
      ),
    staleTime: 10_000,
  });
  const models = useQuery({
    queryKey: ["codebuddy-models"],
    queryFn: async ({ signal }) =>
      parseCodeBuddyModels(
        await apiGet("/api/config/codebuddy/models", { signal }),
      ),
    enabled: status.data?.available === true,
    staleTime: 60_000,
  });
  const login = useMutation({
    mutationFn: () => apiPost("/api/config/codebuddy/login"),
  });
  const check = status.data?.capability_checks?.chat;
  const refresh = async () => {
    await Promise.all([
      status.refetch(),
      models.refetch(),
      client.invalidateQueries({ queryKey: ["codebuddy-status"] }),
    ]);
  };
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        {zh
          ? "使用 CodeBuddy 中国站官方账号与积分。本机 CLI 登录后，Echo 自动沿用授权，无需复制令牌。"
          : "Uses the official CodeBuddy China account and credits. Echo reuses the local CLI login; no token import is needed."}
      </p>
      <div>
        <section className="space-y-2">
          <h4 className="text-sm font-medium">
            {zh ? "本机授权" : "Local authorization"}
          </h4>
          <p role="status" className="text-xs text-muted-foreground">
            {status.isPending
              ? zh
                ? "正在检测 CLI…"
                : "Checking CLI…"
              : status.isError
                ? zh
                  ? "无法读取连接状态"
                  : "Connection status unavailable"
                : status.data?.available
                  ? zh
                    ? "已检测到官方 CLI"
                    : "Official CLI detected"
                  : status.data?.reason}
          </p>
          {status.data?.available && (
            <p className="text-xs text-muted-foreground">
              {check?.state === "verified"
                ? zh
                  ? `最近调用通过${check.model ? ` · ${check.model}` : ""}`
                  : "Recent call verified"
                : check?.state === "failed"
                  ? zh
                    ? "最近调用失败，请检查授权与用量"
                    : "Recent call failed; check login and usage"
                  : zh
                    ? "授权是否有效，以实际调用为准；安装就绪不代表已登录。"
                    : "Login validity is confirmed by an actual call, not CLI installation."}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              disabled={
                !canManage ||
                !status.data?.login_launch_supported ||
                login.isPending
              }
              onClick={() => login.mutate()}
            >
              {login.isPending
                ? zh
                  ? "正在打开…"
                  : "Opening…"
                : zh
                  ? "登录 / 重新授权"
                  : "Sign in / Reauthorize"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={status.isFetching || models.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCwIcon className="size-3.5" />
              {zh ? "刷新连接状态" : "Refresh connection"}
            </Button>
          </div>
          {login.isSuccess && (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              {zh
                ? "已打开官方 CLI。输入 /login，选择中国站完成登录，然后返回此处刷新。"
                : "The official CLI is open. Enter /login, choose the Chinese site, then return and refresh."}
            </p>
          )}
          {login.isError && (
            <p role="alert" className="text-xs text-destructive">
              {login.error instanceof Error
                ? login.error.message
                : zh
                  ? "无法打开登录窗口"
                  : "Could not open the login window"}
            </p>
          )}
          {!canManage && (
            <p className="text-xs text-muted-foreground">
              {zh
                ? "本机账号授权由实例管理员管理。"
                : "The instance administrator manages the machine account."}
            </p>
          )}
          {status.data?.available && !status.data.login_launch_supported && (
            <p className="text-xs leading-5 text-muted-foreground">
              {zh
                ? "此平台暂不支持从 Echo 打开登录窗口，请按官方登录说明在本机 CLI 登录。"
                : "Open the CLI on this platform and follow the official sign-in guide."}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {zh
              ? `可选官方模型：${models.data?.models.length ?? "—"} 个`
              : `Official models: ${models.data?.models.length ?? "—"}`}
          </p>
        </section>
        <a
          className="block text-xs text-muted-foreground underline underline-offset-4"
          href="https://www.codebuddy.cn/docs/cli/quickstart"
          target="_blank"
          rel="noopener noreferrer"
        >
          {zh ? "官方登录说明" : "Official sign-in guide"}
        </a>
      </div>
      <CodeBuddyCredits />
    </div>
  );
}
