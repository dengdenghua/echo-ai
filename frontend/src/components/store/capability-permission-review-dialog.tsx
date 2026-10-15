import { Loader2, ShieldCheck } from "lucide-react";

import { BrandLoadingPanel } from "@/components/brand/brand-progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CapabilityInfo,
  CapabilityInstallPlan,
} from "@/core/agents/agent-world-api";

import { PERMISSION_LABELS } from "./capability-categories";

export function PermissionReviewDialog({
  capability,
  mode,
  plan,
  loading,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  capability: CapabilityInfo;
  mode: "install" | "enable";
  plan: CapabilityInstallPlan | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const permissions = plan?.permissions ?? capability.permissions ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-[min(480px,calc(100vw-2rem))] gap-4 sm:max-w-[480px]">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            确认插件权限 · {capability.name_zh}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {mode === "install"
              ? "先核对签名包会使用的能力；确认后才安装并启用。"
              : "该插件已经安装，但仍处于停用状态。确认权限后才会进入运行时。"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <BrandLoadingPanel label="正在读取…" hideLabel className="min-h-28" />
        ) : plan ? (
          <div className="space-y-3 text-xs">
            <div className="rounded-md border border-border-default bg-muted/25 px-3 py-2 leading-5">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">发布版本</span>
                <span className="font-medium">
                  {plan.version || capability.version}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">安装结果</span>
                <span>
                  {capability.model_provider
                    ? "验证签名 · 安装后配置连接"
                    : "验证签名 · 安装后按确认权限启用"}
                </span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 font-medium">请求的权限</p>
              {permissions.length ? (
                <div className="space-y-1.5">
                  {permissions.map((permission) => (
                    <div
                      key={permission}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-2"
                    >
                      <span>{PERMISSION_LABELS[permission] ?? permission}</span>
                      <code className="text-xs text-muted-foreground">
                        {permission}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md bg-muted/40 px-2.5 py-2 text-muted-foreground">
                  该签名版本没有声明额外运行权限。
                </p>
              )}
            </div>

            {plan.dependencies.length ? (
              <div>
                <p className="mb-1.5 font-medium">依赖</p>
                <div className="space-y-1">
                  {plan.dependencies.map((dependency) => (
                    <div
                      key={dependency.id}
                      className="flex justify-between rounded-md bg-muted/40 px-2.5 py-1.5"
                    >
                      <span>{dependency.id}</span>
                      <span
                        className={
                          dependency.ready
                            ? "text-core"
                            : "text-muted-foreground"
                        }
                      >
                        {dependency.ready ? "已验证" : "待安装"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!plan.can_install ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                当前不能安全安装：{plan.blockers.join("，")}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={loading || busy || !plan?.can_install}
            onClick={onConfirm}
          >
            {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
            {mode === "install" ? "确认并启用" : "确认权限并启用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
