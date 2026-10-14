import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  hubChangeLifecycle,
  hubListPlugins,
  type HubLifecycleAction,
} from "@/core/plugins/api";
import { AutomationPluginDiagnostics } from "./automation-plugin-diagnostics";

export const AUTOMATION_PLUGINS_QUERY_KEY = ["automation-plugins"] as const;

export function AutomationPluginCard({
  pluginId,
}: {
  pluginId: "computer_control" | "browser_control";
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: AUTOMATION_PLUGINS_QUERY_KEY,
    queryFn: hubListPlugins,
  });
  const plugin = query.data?.find((entry) => entry.id === pluginId);
  const mutation = useMutation({
    mutationFn: (action: HubLifecycleAction) =>
      hubChangeLifecycle(pluginId, action),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: AUTOMATION_PLUGINS_QUERY_KEY }),
        client.invalidateQueries({ queryKey: ["browser-relay-status"] }),
        client.invalidateQueries({
          queryKey: ["desktop-automation-permissions"],
        }),
      ]);
    },
  });
  const installed = plugin?.installed !== false;
  const running = plugin?.enabled && plugin.loaded && plugin.started;
  const action: HubLifecycleAction = !installed
    ? "install"
    : running
      ? "disable"
      : "enable";
  const labels = zh
    ? {
        install: "安装并启用",
        enable: "启用插件",
        disable: "停用插件",
        uninstall: "卸载插件",
      }
    : {
        install: "Install and enable",
        enable: "Enable plugin",
        disable: "Disable plugin",
        uninstall: "Uninstall plugin",
      };
  const status = !plugin
    ? zh
      ? "不可用"
      : "Unavailable"
    : !installed
      ? zh
        ? "未安装"
        : "Not installed"
      : running
        ? zh
          ? "已启用"
          : "Enabled"
        : plugin.enabled
          ? zh
            ? "等待运行条件"
            : "Waiting for host availability"
          : zh
            ? "已停用"
            : "Disabled";

  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label={zh ? "自动化插件" : "Automation plugin"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {pluginId === "computer_control"
              ? zh
                ? "电脑控制插件"
                : "Computer control plugin"
              : zh
                ? "浏览器控制插件"
                : "Browser control plugin"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {query.isPending ? (zh ? "加载中…" : "Loading…") : status}
            {plugin ? ` · v${plugin.version}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!plugin || mutation.isPending}
            onClick={() => mutation.mutate(action)}
          >
            {labels[action]}
          </Button>
          {plugin && installed && (
            <Button
              size="sm"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("uninstall")}
            >
              {labels.uninstall}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {zh
          ? "停用会撤销新的自动化调用。卸载保留个人数据，可重新安装；启用仍需满足下方授权与连接条件。"
          : "Disabling revokes new automation calls. Uninstall keeps personal data for reinstall. Access and connection requirements below still apply."}
      </p>
      {(query.error || mutation.error) && (
        <p role="alert" className="text-xs text-destructive">
          {(mutation.error || query.error)?.message}
        </p>
      )}
      {plugin && (
        <AutomationPluginDiagnostics
          pluginId={pluginId}
          lifecycle={`${plugin.installed}:${plugin.enabled}:${plugin.loaded}:${plugin.started}`}
        />
      )}
    </section>
  );
}
