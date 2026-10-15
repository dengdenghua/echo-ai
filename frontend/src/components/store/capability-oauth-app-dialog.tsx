import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { deleteOAuthApp, getOAuthApp, saveOAuthApp } from "@/core/mcp/api";
import { serviceErrorMessage } from "@/core/utils/service-error";

/** 服务商 OAuth App 凭据配置弹窗(BYO OAuth)。
 *
 * GitHub / GitLab 等连接器不暴露 .well-known 元数据,网页登录靠用户在自己账号下
 * 注册一个 OAuth App(免费、几分钟)。这里收集 client_id + client_secret,加密存
 * 到后端(绝不返回明文 secret),保存后自动继续网页授权。
 */
export function OAuthAppDialog({
  open,
  provider,
  providerName,
  docsUrl,
  redirectUri,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  provider: string;
  providerName: string;
  docsUrl: string;
  redirectUri: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [existingMask, setExistingMask] = useState("");

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setClientSecret("");
    setMessage(null);
    setBusy(false);
    void getOAuthApp(provider)
      .then((info) => {
        setHasExisting(info.configured);
        setExistingMask(info.client_id_masked);
      })
      .catch(() => setHasExisting(false));
  }, [open, provider]);

  const onSubmit = async () => {
    if (!clientId.trim()) {
      setMessage("请填写 client_id。");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveOAuthApp(provider, clientId.trim(), clientSecret.trim());
      setMessage("凭据已保存,正在打开授权页…");
      onSaved();
    } catch (err) {
      setMessage(serviceErrorMessage(err));
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await deleteOAuthApp(provider);
      setHasExisting(false);
      setExistingMask("");
      setMessage("已移除本地保存的 OAuth App 凭据。");
    } catch (err) {
      setMessage(serviceErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-[15px]">
            配置 {providerName} OAuth App
          </DialogTitle>
          <DialogDescription className="text-caption leading-5">
            该服务商不支持自动发现(MCP .well-known),网页登录需要你注册一个 OAuth
            App 获取凭据,和 WorkBuddy 用自己平台注册的 App 一个原理。
            凭据仅保存在本机(加密),不会上传。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-xs">
          {docsUrl ? (
            <RoutedWebLink
              href={docsUrl}
              openTargetSource="oauth-app-documentation"
              className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
            >
              如何创建 {providerName} OAuth App(官方文档)
            </RoutedWebLink>
          ) : null}
          <div className="rounded-md bg-muted/60 px-2.5 py-2 leading-5">
            <div className="font-medium text-foreground">
              回调地址(注册 App 时填写)
            </div>
            <code className="mt-0.5 block break-all text-xs text-muted-foreground">
              {redirectUri}
            </code>
          </div>
        </div>

        {hasExisting ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border-default px-2.5 py-2 text-xs">
            <span className="text-muted-foreground">
              已保存 OAuth App:{" "}
              <code className="text-foreground">
                {existingMask || "已配置"}
              </code>
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              移除
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              client_id
            </label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Iv23xxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              client_secret
            </label>
            <Input
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="gho_xxxxxxxxxxxxxxxx"
              autoComplete="off"
              type="password"
            />
          </div>
        </div>

        {message ? (
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 px-2 py-1.5 text-xs text-foreground">
            {message}
          </pre>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void onSubmit()}
          >
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="mr-1 h-3 w-3" />
            )}
            保存并继续授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
