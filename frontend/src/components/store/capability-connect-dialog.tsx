import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  cancelCapabilityDeviceFlow,
  connectCapability,
  getCapabilityDeviceFlow,
  installCapability,
  type CapabilityConnectResult,
  type CapabilityDeviceFlow,
  type CapabilityInfo,
} from "@/core/agents/agent-world-api";
import { serviceErrorMessage } from "@/core/utils/service-error";

import {
  DeviceFlowCloseTimeoutError,
  pollCapabilityDeviceFlow,
  supportsDeviceFlow,
  waitForDeviceFlowClose,
} from "./capability-auth-flow";
import {
  AUTH_LABEL,
  DEFAULT_TYPE_META,
  PERMISSION_LABELS,
  TYPE_META,
} from "./capability-categories";
import {
  openExternalAuthPopup,
  openExternalAuthTab,
  safeExternalAuthUrl,
} from "./external-auth-url";

export function ConnectDialog({
  capability,
  open,
  onOpenChange,
  onConnected,
}: {
  capability: CapabilityInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [accessToken, setAccessToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [oneIdToken, setOneIdToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<
    CapabilityConnectResult["device_flow"] | null
  >(null);

  const isCli = capability.type === "cli";
  const isFreebuffCli = isCli && capability.id === "freebuff-cli";
  const isPlugin = capability.source === "codex_plugin";
  const modelProvider = capability.model_provider ?? null;
  const isModelProvider = Boolean(modelProvider);
  const modelProviderPermissions = isModelProvider
    ? capability.permissions_granted?.length
      ? capability.permissions_granted
      : capability.permission_review_required
        ? (capability.permissions ?? [])
        : []
    : [];
  const isOneId = capability.auth_mode === "oneid-token";
  const canUseDeviceFlow = supportsDeviceFlow(capability);
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  const onConnectedRef = useRef(onConnected);
  const pollAbortRef = useRef<AbortController | null>(null);
  const operationEpochRef = useRef(0);
  const closingRef = useRef(false);
  const submitOperationRef = useRef<Promise<void> | null>(null);
  const recoveryOperationRef = useRef<Promise<void> | null>(null);
  const lateDeviceFlowRef = useRef<CapabilityDeviceFlow | null>(null);
  const lateRecoveryDeviceFlowRef = useRef<CapabilityDeviceFlow | null>(null);
  const activeDeviceFlowRef = useRef<CapabilityDeviceFlow | null>(null);

  const stopDeviceFlowPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const monitorDeviceFlow = useCallback(
    (flow: CapabilityDeviceFlow, operationEpoch: number) => {
      stopDeviceFlowPolling();
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const expiresInSeconds = Math.min(
        900,
        Math.max(1, Number(flow.expires_in) || 240),
      );

      void pollCapabilityDeviceFlow(
        capability.id,
        flow.flow_id,
        expiresInSeconds * 1000,
        controller.signal,
      ).then(async (outcome) => {
        if (
          outcome === "cancelled" ||
          controller.signal.aborted ||
          operationEpochRef.current !== operationEpoch ||
          !mountedRef.current ||
          !openRef.current
        ) {
          return;
        }
        if (pollAbortRef.current === controller) {
          pollAbortRef.current = null;
        }
        if (outcome === "connected") {
          setMessage("设备流登录完成");
          activeDeviceFlowRef.current = null;
          setDeviceFlow(null);
          onConnectedRef.current();
          return;
        }

        try {
          await cancelCapabilityDeviceFlow(capability.id, flow.flow_id);
        } catch {
          if (
            operationEpochRef.current === operationEpoch &&
            mountedRef.current &&
            openRef.current
          ) {
            setMessage("设备流已结束，但无法确认后台进程已清理，请重试取消。");
          }
          return;
        }
        if (
          operationEpochRef.current !== operationEpoch ||
          !mountedRef.current ||
          !openRef.current
        ) {
          return;
        }
        activeDeviceFlowRef.current = null;
        setDeviceFlow(null);
        setMessage(
          outcome === "replaced"
            ? "设备流已被另一个窗口的新授权替换。"
            : "设备流授权未在有效期内完成,可重试或手动执行 CLI 登录。",
        );
      });
    },
    [capability.id, stopDeviceFlowPolling],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRef.current = false;
      closingRef.current = false;
      operationEpochRef.current += 1;
      stopDeviceFlowPolling();
      const activeFlow = activeDeviceFlowRef.current;
      activeDeviceFlowRef.current = null;
      if (activeFlow) {
        void cancelCapabilityDeviceFlow(
          capability.id,
          activeFlow.flow_id,
        ).catch(() => undefined);
      }
    };
  }, [capability.id, stopDeviceFlowPolling]);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      operationEpochRef.current += 1;
      stopDeviceFlowPolling();
      return;
    }

    const operationEpoch = operationEpochRef.current + 1;
    operationEpochRef.current = operationEpoch;
    closingRef.current = false;
    setAccessToken("");
    setApiKey("");
    setBaseUrl("");
    setOneIdToken("");
    setMessage(null);
    setBusy(false);
    setClosing(false);
    activeDeviceFlowRef.current = null;
    setDeviceFlow(null);
    if (!canUseDeviceFlow) return;

    setBusy(true);
    const recoveryOperation = (async () => {
      try {
        const status = await getCapabilityDeviceFlow(capability.id);
        const isCurrentOperation =
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current;
        if (status.active && status.device_flow) {
          if (!isCurrentOperation) {
            lateRecoveryDeviceFlowRef.current = status.device_flow;
            // closeDialog owns cleanup while waiting for this recovery. A
            // forced unmount has no waiter, so the late response cleans itself.
            if (!closingRef.current) {
              try {
                await cancelCapabilityDeviceFlow(
                  capability.id,
                  status.device_flow.flow_id,
                );
              } finally {
                if (
                  lateRecoveryDeviceFlowRef.current?.flow_id ===
                  status.device_flow.flow_id
                ) {
                  lateRecoveryDeviceFlowRef.current = null;
                }
              }
            }
            return;
          }
          activeDeviceFlowRef.current = status.device_flow;
          setDeviceFlow(status.device_flow);
          monitorDeviceFlow(status.device_flow, operationEpoch);
        }
      } catch {
        if (
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current
        ) {
          setMessage("无法恢复进行中的设备流授权，请重试。");
        }
      } finally {
        if (
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current
        ) {
          setBusy(false);
        }
      }
    })();
    recoveryOperationRef.current = recoveryOperation;
    void recoveryOperation.finally(() => {
      if (recoveryOperationRef.current === recoveryOperation) {
        recoveryOperationRef.current = null;
      }
    });
  }, [
    canUseDeviceFlow,
    capability.id,
    monitorDeviceFlow,
    open,
    stopDeviceFlowPolling,
  ]);

  const closeDialog = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    operationEpochRef.current += 1;
    openRef.current = false;
    stopDeviceFlowPolling();
    setBusy(true);
    setClosing(true);
    try {
      // Keep the dialog in a closing state until in-flight connect/recovery
      // requests settle. The final generation-scoped DELETE then cannot lose
      // a device flow that arrives between the user's close and the response.
      const pendingOperations = [
        submitOperationRef.current,
        recoveryOperationRef.current,
      ].filter((operation): operation is Promise<void> => operation !== null);
      if (pendingOperations.length > 0) {
        await waitForDeviceFlowClose(
          Promise.all(pendingOperations).then(() => undefined),
        );
      }
      const ownedFlow =
        lateDeviceFlowRef.current ??
        lateRecoveryDeviceFlowRef.current ??
        activeDeviceFlowRef.current ??
        deviceFlow;
      if (canUseDeviceFlow && ownedFlow) {
        await waitForDeviceFlowClose(
          cancelCapabilityDeviceFlow(capability.id, ownedFlow.flow_id),
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        openRef.current = true;
        closingRef.current = false;
        setBusy(submitOperationRef.current !== null);
        setClosing(false);
        setMessage(
          error instanceof DeviceFlowCloseTimeoutError
            ? "连接操作仍在处理中，已隔离迟到结果；请稍后重试关闭。"
            : error instanceof Error
              ? error.message
              : String(error),
        );
        const recoverableFlow =
          lateDeviceFlowRef.current ??
          lateRecoveryDeviceFlowRef.current ??
          activeDeviceFlowRef.current ??
          deviceFlow;
        if (recoverableFlow) {
          activeDeviceFlowRef.current = recoverableFlow;
          setDeviceFlow(recoverableFlow);
          monitorDeviceFlow(recoverableFlow, operationEpochRef.current);
        }
      }
      return;
    }
    if (!mountedRef.current) return;
    closingRef.current = false;
    setBusy(false);
    setClosing(false);
    activeDeviceFlowRef.current = null;
    setDeviceFlow(null);
    lateDeviceFlowRef.current = null;
    lateRecoveryDeviceFlowRef.current = null;
    onOpenChange(false);
  }, [
    canUseDeviceFlow,
    capability.id,
    deviceFlow,
    monitorDeviceFlow,
    onOpenChange,
    stopDeviceFlowPolling,
  ]);

  const onSubmit = () => {
    if (submitOperationRef.current || closingRef.current) {
      return Promise.resolve();
    }
    const operationEpoch = operationEpochRef.current + 1;
    operationEpochRef.current = operationEpoch;
    lateDeviceFlowRef.current = null;
    stopDeviceFlowPolling();
    setBusy(true);
    setMessage(null);
    const operation = (async () => {
      try {
        if (isModelProvider && !capability.installed) {
          await installCapability(capability.id);
        }
        const tokens: Record<string, string> = {};
        if (isOneId) {
          if (oneIdToken.trim()) tokens.oneid_token = oneIdToken.trim();
        } else {
          if (accessToken.trim()) tokens.access_token = accessToken.trim();
          if (apiKey.trim()) tokens.api_key = apiKey.trim();
          if (isModelProvider && baseUrl.trim()) {
            tokens.base_url = baseUrl.trim();
          }
        }
        const res = await connectCapability(capability.id, {
          tokens: Object.keys(tokens).length ? tokens : undefined,
          run_cli: isCli && Object.keys(tokens).length === 0,
          ...(modelProviderPermissions.length > 0
            ? { grant_permissions: modelProviderPermissions }
            : {}),
        });
        const isCurrentOperation =
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current;
        if (!isCurrentOperation) {
          // A non-close unmount still owns cleanup for a device flow created by
          // its late response. During close, closeDialog waits for this task
          // and performs the final DELETE itself.
          if (res.device_flow) {
            lateDeviceFlowRef.current = res.device_flow;
            if (!closingRef.current) {
              try {
                await cancelCapabilityDeviceFlow(
                  capability.id,
                  res.device_flow.flow_id,
                );
                lateDeviceFlowRef.current = null;
              } catch (cleanupError) {
                if (mountedRef.current && openRef.current) {
                  const recoveryEpoch = operationEpochRef.current;
                  activeDeviceFlowRef.current = res.device_flow;
                  setDeviceFlow(res.device_flow);
                  setMessage(
                    cleanupError instanceof Error
                      ? cleanupError.message
                      : String(cleanupError),
                  );
                  monitorDeviceFlow(res.device_flow, recoveryEpoch);
                }
              }
            }
          }
          return;
        }
        if (res.connected) {
          stopDeviceFlowPolling();
          setMessage(isPlugin ? "插件无需认证,已就绪" : "已连接");
          activeDeviceFlowRef.current = null;
          setDeviceFlow(null);
          onConnectedRef.current();
        } else if (res.device_flow) {
          // CLI 设备流:展示授权地址 + 自动打开 + 轮询状态
          activeDeviceFlowRef.current = res.device_flow;
          setDeviceFlow(res.device_flow);
          const uri = res.device_flow.verification_uri;
          if (uri) {
            if (!safeExternalAuthUrl(uri)) {
              setMessage("授权地址不是 http(s) 链接,已拒绝打开。");
            } else {
              const popup = openExternalAuthPopup(
                uri,
                "echo-device-flow",
                "popup=yes,width=560,height=720",
              );
              if (!popup)
                setMessage("已复制授权地址,请手动打开(浏览器拦截了弹窗)。");
            }
          }
          if (
            operationEpochRef.current === operationEpoch &&
            mountedRef.current &&
            openRef.current
          ) {
            monitorDeviceFlow(res.device_flow, operationEpoch);
          }
        } else if (res.command) {
          setMessage(`请在终端执行:\n${res.command}`);
        } else {
          setMessage(res.message || "连接未确认");
        }
      } catch (err) {
        if (
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current
        ) {
          setMessage(serviceErrorMessage(err));
        }
      } finally {
        if (
          operationEpochRef.current === operationEpoch &&
          mountedRef.current &&
          openRef.current
        ) {
          setBusy(false);
        }
      }
    })();
    submitOperationRef.current = operation;
    void operation.finally(() => {
      if (submitOperationRef.current === operation) {
        submitOperationRef.current = null;
        if (mountedRef.current && openRef.current && !closingRef.current) {
          setBusy(false);
        }
      }
    });
    return operation;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) void closeDialog();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[min(420px,calc(100vw-2rem))] gap-3 rounded-lg p-4 sm:max-w-[420px]"
      >
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-[15px]">
            连接 · {capability.name_zh}
          </DialogTitle>
          <DialogDescription className="text-caption leading-5">
            类型 {(TYPE_META[capability.type] ?? DEFAULT_TYPE_META).label} ·
            认证 {AUTH_LABEL[capability.auth_mode] ?? capability.auth_mode}
          </DialogDescription>
        </DialogHeader>

        {isPlugin && (
          <p className="text-xs leading-5 text-muted-foreground">
            插件(ECHO AI
            插件)无需认证,安装后技能即可用。点「保存凭据」直接确认就绪。
          </p>
        )}

        {!isCli && !isPlugin && isOneId && (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground">
              OneID Token(腾讯统一身份)
            </label>
            <Input
              value={oneIdToken}
              onChange={(e) => setOneIdToken(e.target.value)}
              placeholder="粘贴 OneID access token"
              className="h-8 text-sm"
            />
          </div>
        )}

        {!isCli && !isPlugin && !isOneId && !isModelProvider && (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground">
              access_token
            </label>
            <Input
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="粘贴 access_token"
              className="h-8 text-sm"
            />
            <label className="text-xs text-muted-foreground">api_key</label>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="粘贴 api_key(可选)"
              className="h-8 text-sm"
            />
          </div>
        )}

        {isModelProvider && modelProvider ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border-default bg-muted/25 p-2.5 text-xs leading-5">
              <p className="font-medium text-foreground">
                {modelProvider.connection_note_zh ??
                  "直连模型 API，不安装或检测任何 CLI"}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Key 会加密保存在本机；模型继续使用 ECHO AI
                的流式输出、工具调用和记忆。
              </p>
              {modelProvider.dashboard_url ? (
                <RoutedWebLink
                  href={modelProvider.dashboard_url}
                  openTargetSource="model-provider-api-key"
                  className="mt-1.5 inline-flex text-primary underline underline-offset-2"
                >
                  {modelProvider.login_cta_zh ?? "登录服务商并获取 API Key"}
                </RoutedWebLink>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="model-provider-api-key"
                className="text-xs font-medium"
              >
                {modelProvider.api_key_label_zh ??
                  `${modelProvider.display_name_zh ?? modelProvider.display_name ?? capability.name_zh} API Key`}
              </label>
              <Input
                id="model-provider-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  ["opencode-go", "opencode-zen"].includes(capability.id)
                    ? "留空复用已保存的 OpenCode Key"
                    : "粘贴 API Key"
                }
                className="h-9 text-sm"
              />
              {capability.id === "opencode-go" && (
                <p className="text-xs text-muted-foreground">
                  已连接 Zen 可直接连接 Go，无需重复填写。填写新 Key 会更新 Go /
                  Zen 共用的凭据；Go 仍需有效套餐。
                </p>
              )}
            </div>
            {modelProvider.configurable_base_url ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="model-provider-base-url"
                  className="text-xs font-medium"
                >
                  服务地址
                </label>
                <Input
                  id="model-provider-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={modelProvider.base_url}
                  className="h-9 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  留空使用默认地址；自托管服务请填写以 /v1 结尾的地址。
                </p>
              </div>
            ) : null}
            {modelProvider.free_models.length > 0 ? (
              <div className="rounded-md bg-muted/40 p-2.5 text-xs">
                <p className="font-medium text-foreground">
                  {modelProvider.model_list_label_zh ?? "预置模型"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {modelProvider.free_models.map((model) => (
                    <code
                      key={model}
                      className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {model}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
            {(modelProvider.privacy_notices_zh ?? []).length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-xs leading-5 text-warning">
                {(modelProvider.privacy_notices_zh ?? []).map((notice) => (
                  <p key={notice}>• {notice}</p>
                ))}
              </div>
            ) : null}
            {capability.permission_review_required &&
            modelProviderPermissions.length > 0 ? (
              <div className="rounded-md border border-border-default px-2.5 py-2 text-xs leading-5">
                <p className="font-medium text-foreground">
                  连接时将确认以下权限
                </p>
                {modelProviderPermissions.map((permission) => (
                  <p key={permission} className="text-muted-foreground">
                    • {PERMISSION_LABELS[permission] ?? permission}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {isCli &&
          !deviceFlow &&
          (isFreebuffCli ? (
            <div className="space-y-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs leading-5">
              <p className="font-medium text-foreground">
                官方 Freebuff CLI · 交互式本地智能体
              </p>
              <p className="text-muted-foreground">
                登录会打开 freebuff.com 官方授权页。ECHO AI
                不读取或保存其登录凭据；Freebuff
                会处理你交给它的对话、代码和工作区文件。
              </p>
              <p className="text-warning">
                当前官方免费 CLI 不提供非交互
                Prompt/API，因此不会出现在模型选择器中。
              </p>
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              CLI 型插件将执行 cli.json 的登录命令(浏览器/设备流)。点「执行 CLI
              登录」自动开始。
            </p>
          ))}

        {deviceFlow ? (
          <div className="space-y-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
            <p className="text-foreground">
              {deviceFlow.message || "请在浏览器完成授权"}
            </p>
            {deviceFlow.user_code && !deviceFlow.code_embedded_in_uri ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">验证码</span>
                <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[12px]">
                  {deviceFlow.user_code}
                </code>
              </div>
            ) : null}
            <div className="flex items-center gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={!safeExternalAuthUrl(deviceFlow.verification_uri)}
                onClick={() => openExternalAuthTab(deviceFlow.verification_uri)}
              >
                打开授权页
              </Button>
              <span className="text-muted-foreground">
                等待授权完成…({deviceFlow.expires_in || 240}s)
              </span>
            </div>
          </div>
        ) : null}

        {message ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 px-2 py-1.5 text-xs text-foreground">
            {message}
          </pre>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={closing}
            onClick={() => void closeDialog()}
          >
            {closing ? "正在关闭…" : deviceFlow ? "关闭" : "取消"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              (isModelProvider &&
                !["opencode-go", "opencode-zen"].includes(capability.id) &&
                !apiKey.trim())
            }
            onClick={() => void onSubmit()}
          >
            {busy ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="mr-1 h-3 w-3" />
            )}
            {isCli
              ? deviceFlow
                ? "重新登录"
                : isFreebuffCli
                  ? "登录 Freebuff"
                  : "执行 CLI 登录"
              : isModelProvider
                ? "验证并连接"
                : "保存凭据"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
