import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { hubAutomationDiagnostics } from "@/core/plugins/api";

const CHECK_LABELS: Record<string, [string, string]> = {
  pyautogui: ["鼠标键盘与截图驱动", "Mouse, keyboard and capture driver"],
  uia: ["Windows 控件识别", "Windows UI Automation"],
  vision: ["视觉模型连接", "Vision model configuration"],
  desktop_session: ["桌面权限与实际操作", "Desktop permissions and execution"],
  playwright: ["Playwright 驱动", "Playwright driver"],
  electron: ["内置浏览器连接", "Built-in browser connection"],
  relay: ["浏览器扩展连接", "Browser extension connection"],
  browser_execution: [
    "浏览器运行时与实际操作",
    "Browser runtime and execution",
  ],
};
const STATES: Record<string, [string, string]> = {
  available: ["驱动可用", "Driver available"],
  unavailable: ["驱动缺失或无法加载", "Driver missing or unable to load"],
  unsupported: ["不适用", "Not applicable"],
  connected: ["已连接", "Connected"],
  disconnected: ["未连接", "Disconnected"],
  configured: ["已配置", "Configured"],
  unconfigured: ["未配置", "Not configured"],
  unverified: ["待实际验证", "Not yet verified"],
};

export function AutomationPluginDiagnostics({
  pluginId,
  lifecycle,
}: {
  pluginId: string;
  lifecycle: string;
}) {
  const { locale } = useI18n();
  const lang = locale.startsWith("zh") ? 0 : 1;
  const query = useQuery({
    queryKey: ["automation-plugin-diagnostics", pluginId, lifecycle],
    queryFn: () => hubAutomationDiagnostics(pluginId),
    staleTime: 15_000,
    retry: false,
  });
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium">
          {lang === 0 ? "执行条件检查" : "Execution prerequisites"}
        </h4>
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching
            ? lang === 0
              ? "检查中…"
              : "Checking…"
            : lang === 0
              ? "重新检查"
              : "Check again"}
        </Button>
      </div>
      {query.data && (
        <>
          <p className="text-xs text-muted-foreground">
            {query.data.execution_status === "blocked"
              ? lang === 0
                ? "尚不具备执行条件，请检查插件开关和驱动。"
                : "Execution is blocked. Check plugin access and drivers."
              : lang === 0
                ? "已检测到驱动；尚未验证完整操作。"
                : "Driver detected; end-to-end operation has not been verified."}
          </p>
          <dl className="space-y-1 text-xs">
            {query.data.checks.map((check) => (
              <div
                key={check.id}
                className="flex flex-wrap justify-between gap-2"
              >
                <dt>{CHECK_LABELS[check.id]?.[lang] ?? check.id}</dt>
                <dd className="text-muted-foreground">
                  {STATES[check.status]?.[lang] ?? check.status}
                </dd>
              </div>
            ))}
          </dl>
          {query.data.checks.some(
            (check) => check.status === "unavailable",
          ) && (
            <p className="text-xs text-muted-foreground">
              {lang === 0
                ? "缺少驱动时，安装对应插件依赖并重启 Echo 后端；可选驱动无需全部安装。"
                : "Install the relevant plugin dependencies and restart the Echo backend. Alternative drivers are optional."}
            </p>
          )}
        </>
      )}
      {query.error && (
        <p role="alert" className="text-xs text-destructive">
          {lang === 0
            ? "无法读取执行条件，请重试或检查后端连接。"
            : "Unable to check prerequisites. Retry or check the backend connection."}
        </p>
      )}
    </div>
  );
}
