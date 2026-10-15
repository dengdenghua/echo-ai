/**
 * HUB 应用 · 「扩展插件」: ECHO AI's bundled long-tail plugins.
 *
 * They ship with the app but stay out of the startup path until someone
 * installs one here; installing makes it live at once and keeps it across
 * restarts, and uninstalling keeps its data. Plugins are machine-wide, so
 * only the instance admin is offered the actions, like engines and
 * workbench packages.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenIcon,
  CandlestickChartIcon,
  ClapperboardIcon,
  DownloadIcon,
  EyeIcon,
  GitPullRequestIcon,
  Loader2Icon,
  LockIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PowerIcon,
  PowerOffIcon,
  PuzzleIcon,
  ScissorsIcon,
  Trash2Icon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import {
  pluginStoreCopy,
  type PluginStoreCopy,
} from "@/core/i18n/locales/plugin-store";
import {
  hubChangeLifecycle,
  type HubLifecycleAction,
} from "@/core/plugins/api";
import { useHubPlugins } from "@/core/plugins/hooks";
import type { HubPluginInfo } from "@/core/plugins/types";
import {
  useCanManageWorkbenches,
  workbenchActionErrorMessage,
} from "@/core/workbench/workbench-permissions";

import { EngineStoreSection } from "./engine-store-section";

const PLUGIN_ICONS: Record<string, LucideIcon> = {
  clip_studio: ScissorsIcon,
  director_stage: ClapperboardIcon,
  comfyui_bridge: WorkflowIcon,
  mx2025_viewer: MessagesSquareIcon,
  whale_eye: EyeIcon,
  github: GitPullRequestIcon,
  project_wiki: BookOpenIcon,
  paper_trading_replica: CandlestickChartIcon,
};

const ACTION_BUTTON =
  "absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-micro font-medium";

function pluginTitle(plugin: HubPluginInfo, copy: PluginStoreCopy): string {
  return (
    copy.plugins[plugin.id]?.name ||
    plugin.display_name ||
    plugin.name ||
    plugin.id
  );
}

function pluginStatus(
  plugin: HubPluginInfo,
  copy: PluginStoreCopy,
): { text: string; tone: "muted" | "destructive" } {
  if (plugin.installed === false) {
    return { text: copy.notInstalled, tone: "muted" };
  }
  if (!plugin.enabled) return { text: copy.disabled, tone: "muted" };
  if (!plugin.loaded || plugin.error) {
    return { text: copy.failed, tone: "destructive" };
  }
  return { text: copy.active(plugin.version), tone: "muted" };
}

function PluginRow({
  plugin,
  copy,
  canManage,
  pending,
  onAction,
}: {
  plugin: HubPluginInfo;
  copy: PluginStoreCopy;
  canManage: boolean;
  pending: boolean;
  onAction: (action: HubLifecycleAction) => void;
}) {
  const Icon = PLUGIN_ICONS[plugin.id] ?? PuzzleIcon;
  const title = pluginTitle(plugin, copy);
  const status = pluginStatus(plugin, copy);
  const installed = plugin.installed !== false;
  return (
    <div
      className="group relative border-b border-border-subtle transition-colors hover:bg-muted/25"
      data-testid={`optional-plugin-${plugin.id}`}
    >
      <div className="flex min-h-16 w-full items-center gap-3 px-2 py-2 pr-24 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted ring-1 ring-inset ring-border">
          <Icon className="size-[18px] text-foreground" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-ui text-muted-foreground">
            {copy.plugins[plugin.id]?.description || plugin.description}
          </span>
          <span
            role={status.tone === "destructive" ? "alert" : undefined}
            className={`mt-0.5 block text-micro ${
              status.tone === "destructive"
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {status.text}
          </span>
        </span>
      </div>
      {pending ? (
        <span className={ACTION_BUTTON}>
          <Loader2Icon className="size-4 animate-spin text-primary" />
        </span>
      ) : !canManage ? (
        installed ? null : (
          <span className={`${ACTION_BUTTON} gap-1 text-muted-foreground`}>
            <LockIcon className="size-3.5" aria-hidden="true" />
            {copy.adminOnly}
          </span>
        )
      ) : !installed ? (
        <button
          type="button"
          aria-label={copy.installPlugin(title)}
          onClick={() => onAction("install")}
          className={`${ACTION_BUTTON} text-primary transition-colors hover:text-primary/75`}
        >
          <DownloadIcon className="size-3.5" />
          {copy.install}
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
              aria-label={copy.manage(title)}
              title={copy.manage(title)}
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {plugin.enabled ? (
              <DropdownMenuItem onSelect={() => onAction("disable")}>
                <PowerOffIcon className="size-4" />
                {copy.disable}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onAction("enable")}>
                <PowerIcon className="size-4" />
                {copy.enable}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onAction("uninstall")}
            >
              <Trash2Icon className="size-4" />
              {copy.uninstall}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function PluginStoreSection() {
  const { locale } = useI18n();
  const copy = pluginStoreCopy(locale);
  const canManage = useCanManageWorkbenches();
  const client = useQueryClient();
  const { plugins, error } = useHubPlugins();
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: HubLifecycleAction }) =>
      hubChangeLifecycle(id, action),
    onSuccess: (_result, { id, action }) => {
      if (action === "install") {
        const plugin = plugins.find((entry) => entry.id === id);
        toast.success(copy.installed(plugin ? pluginTitle(plugin, copy) : id));
      }
    },
    onError: (failure) => toast.error(workbenchActionErrorMessage(failure)),
    onSettled: () => client.invalidateQueries({ queryKey: ["plugins", "hub"] }),
  });
  const optional = plugins.filter((plugin) => plugin.optional === true);
  if (!error && optional.length === 0) return null;
  return (
    <div className="mb-6" data-testid="plugin-store">
      <h3 className="mb-1 text-sm font-semibold">{copy.sectionTitle}</h3>
      <p className="mb-2 max-w-3xl text-ui text-muted-foreground">
        {copy.sectionHint}
      </p>
      {error ? (
        <p role="alert" className="py-2 text-ui text-muted-foreground">
          {copy.unavailable}
        </p>
      ) : null}
      <div className="grid gap-x-8 sm:grid-cols-2">
        {optional.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            copy={copy}
            canManage={canManage}
            pending={mutation.isPending && mutation.variables?.id === plugin.id}
            onAction={(action) => mutation.mutate({ id: plugin.id, action })}
          />
        ))}
      </div>
    </div>
  );
}

/** The HUB 应用 groups whose items are installed on demand. */
export function OnDemandStoreSections() {
  return (
    <>
      <EngineStoreSection />
      <PluginStoreSection />
    </>
  );
}
