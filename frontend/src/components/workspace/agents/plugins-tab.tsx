/**
 * HUB plugins: the plugin directory, its filters and per-plugin configuration.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon, PuzzleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { swallow } from "@/core/utils/log";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { isRecord } from "@/core/utils/guards";
import {
  listPlugins,
  hubListPlugins,
  hubGetPluginConfig,
  hubUpdatePluginConfig,
} from "@/core/plugins/api";
import type { PluginInfo, HubPluginInfo } from "@/core/plugins/types";
import { getBackendBaseURL } from "@/core/config";
import {
  CheckCircle as CheckCircleIcon,
  XCircle as XCircleIcon,
  Settings2 as Settings2Icon,
} from "lucide-react";
import { useOpenCreatePluginChat } from "@/components/store/store-utils";

export type PluginEntry =
  | { plugin: HubPluginInfo; source: "hub" }
  | { plugin: PluginInfo; source: "legacy" };
const PLUGIN_STATUS_FILTERS = ["all", "enabled", "disabled"] as const;
export type PluginStatusFilter = (typeof PLUGIN_STATUS_FILTERS)[number];

function isPluginStatusFilter(value: string): value is PluginStatusFilter {
  return PLUGIN_STATUS_FILTERS.some((filter) => filter === value);
}

interface ConfigField {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
}

function stringField(
  record: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

/** The fields a plugin's JSON-schema config declares, read defensively. */
function configFields(
  schema: Record<string, unknown> | undefined,
): Record<string, ConfigField> | undefined {
  const properties = schema?.properties;
  if (!isRecord(properties)) return undefined;
  const fields: Record<string, ConfigField> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue;
    fields[key] = {
      type: stringField(value, "type"),
      title: stringField(value, "title"),
      description: stringField(value, "description"),
      format: stringField(value, "format"),
    };
  }
  return fields;
}

export function pluginImageUrl(
  plugin: PluginInfo | HubPluginInfo,
): string | null {
  const raw =
    ("logo_url" in plugin ? plugin.logo_url : null) ||
    ("icon_url" in plugin ? plugin.icon_url : null);
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${getBackendBaseURL()}${raw}`;
}

export function HubPluginConfigDialog({
  plugin,
  open,
  onOpenChange,
}: {
  plugin: HubPluginInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      hubGetPluginConfig(plugin.id)
        .then(setConfig)
        .catch((e) => swallow(e));
    }
  }, [plugin.id, open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await hubUpdatePluginConfig(plugin.id, config);
      onOpenChange(false);
    } catch (e) {
      swallow(e);
    } finally {
      setSaving(false);
    }
  };

  const properties = configFields(plugin.config_schema);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.plugins.configureTitle(plugin.name)}</DialogTitle>
          <DialogDescription>
            {t.plugins.configureDescription(plugin.name)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {properties && Object.keys(properties).length > 0 ? (
            Object.entries(properties).map(([key, prop]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`cfg-${key}`}>{prop.title || key}</Label>
                {prop.description && (
                  <p className="text-ui text-muted-foreground">
                    {prop.description}
                  </p>
                )}
                <Input
                  id={`cfg-${key}`}
                  type={
                    prop.format === "password"
                      ? "password"
                      : prop.type === "integer"
                        ? "number"
                        : "text"
                  }
                  value={String(config[key] ?? "")}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      [key]:
                        prop.type === "integer"
                          ? parseInt(e.target.value) || 0
                          : e.target.value,
                    }))
                  }
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.plugins.configureNoConfig}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t.plugins.configureCancel}</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t.plugins.configureSaving : t.plugins.configureSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PluginListItem({
  entry,
  onConfigure,
}: {
  entry: PluginEntry;
  onConfigure: (plugin: HubPluginInfo) => void;
}) {
  const { t } = useI18n();
  const { plugin } = entry;
  const hubPlugin = entry.source === "hub" ? entry.plugin : null;
  const imageUrl = pluginImageUrl(plugin);
  const hasConfig = Boolean(
    hubPlugin?.config_schema && Object.keys(hubPlugin.config_schema).length > 0,
  );
  const statusTitle = plugin.error
    ? t.plugins.statusErrorTooltip
    : plugin.enabled
      ? t.plugins.statusEnabledTooltip
      : t.plugins.statusDisabledTooltip;

  return (
    <Card className="group flex flex-col gap-3 border border-border bg-card p-3 shadow-none transition-colors hover:bg-accent/30 sm:flex-row sm:items-center">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background",
          !plugin.enabled && "bg-muted/40",
        )}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="size-8 object-contain"
            loading="lazy"
          />
        ) : (
          <PuzzleIcon
            className={cn(
              "size-5",
              plugin.enabled ? "text-primary" : "text-muted-foreground",
            )}
          />
        )}
      </div>
      <CardContent className="min-w-0 flex-1 p-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold leading-5">
            {plugin.name}
          </h3>
        </div>
        <p className="mt-0.5 line-clamp-1 text-sm leading-5 text-muted-foreground">
          {plugin.description}
        </p>
      </CardContent>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasConfig && hubPlugin && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.plugins.configureTitle(plugin.name)}
            className="size-8"
            onClick={() => onConfigure(hubPlugin)}
          >
            <Settings2Icon className="size-4" />
          </Button>
        )}
        <span
          title={statusTitle}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg transition-colors",
            plugin.error
              ? "bg-destructive/10 text-destructive"
              : plugin.enabled
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted",
          )}
        >
          {plugin.error ? (
            <XCircleIcon className="size-5" />
          ) : plugin.enabled ? (
            <CheckCircleIcon className="size-5" />
          ) : (
            <PlusIcon className="size-5" />
          )}
        </span>
      </div>
    </Card>
  );
}

export function PluginsTabContent({ searchQuery }: { searchQuery: string }) {
  const { t } = useI18n();
  const openCreatePluginChat = useOpenCreatePluginChat();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [hubPlugins, setHubPlugins] = useState<HubPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [configTarget, setConfigTarget] = useState<HubPluginInfo | null>(null);
  const [pluginAuthorFilter, setPluginAuthorFilter] = useState("all");
  const [pluginStatusFilter, setPluginStatusFilter] =
    useState<PluginStatusFilter>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [legacy, hub] = await Promise.all([
        listPlugins().catch((): PluginInfo[] => []),
        hubListPlugins().catch((): HubPluginInfo[] => []),
      ]);
      setPlugins(legacy);
      setHubPlugins(hub);
    } catch (e) {
      swallow(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pluginEntries = useMemo<PluginEntry[]>(() => {
    const hubEntries = hubPlugins
      .filter((plugin) => plugin.id !== "openproject-pm")
      .map((plugin) => ({ plugin, source: "hub" as const }));
    const legacyEntries = plugins.map((plugin) => ({
      plugin,
      source: "legacy" as const,
    }));
    return [...hubEntries, ...legacyEntries].sort((a, b) =>
      a.plugin.name.localeCompare(b.plugin.name),
    );
  }, [hubPlugins, plugins]);

  const pluginAuthors = useMemo(() => {
    return Array.from(
      new Set(pluginEntries.map(({ plugin }) => plugin.author).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));
  }, [pluginEntries]);

  const filteredPluginEntries = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return pluginEntries.filter(({ plugin }) => {
      if (
        pluginAuthorFilter !== "all" &&
        plugin.author !== pluginAuthorFilter
      ) {
        return false;
      }
      if (pluginStatusFilter === "enabled" && !plugin.enabled) return false;
      if (pluginStatusFilter === "disabled" && plugin.enabled) return false;
      if (!needle) return true;
      return [
        plugin.name,
        plugin.description,
        plugin.author,
        plugin.version,
        plugin.state,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [pluginAuthorFilter, pluginEntries, searchQuery, pluginStatusFilter]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <PuzzleIcon className="size-8 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue="local">
        <TabsList variant="line" className="mb-1">
          <TabsTrigger value="local" className="h-8 gap-1.5 px-3 text-ui">
            {t.agentWorldUnified.enabledTab}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="mt-0 flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={pluginAuthorFilter}
                onValueChange={setPluginAuthorFilter}
              >
                <SelectTrigger className="h-9 w-auto gap-2 rounded-lg bg-background shadow-none">
                  <SelectValue>
                    {pluginAuthorFilter === "all"
                      ? t.plugins.filterAllAuthors
                      : t.plugins.filterByAuthor(pluginAuthorFilter)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t.plugins.filterAllAuthors}
                  </SelectItem>
                  {pluginAuthors.map((author) => (
                    <SelectItem key={author} value={author}>
                      {t.plugins.filterByAuthor(author)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={pluginStatusFilter}
                onValueChange={(value) => {
                  if (isPluginStatusFilter(value)) setPluginStatusFilter(value);
                }}
              >
                <SelectTrigger className="h-9 w-auto gap-2 rounded-lg bg-background shadow-none">
                  <SelectValue>
                    {pluginStatusFilter === "all" && t.plugins.statusAll}
                    {pluginStatusFilter === "enabled" &&
                      t.plugins.statusEnabledFilter}
                    {pluginStatusFilter === "disabled" &&
                      t.plugins.statusDisabledFilter}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.plugins.statusAll}</SelectItem>
                  <SelectItem value="enabled">
                    {t.plugins.statusEnabledFilter}
                  </SelectItem>
                  <SelectItem value="disabled">
                    {t.plugins.statusDisabledFilter}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-lg px-3 text-ui"
              onClick={openCreatePluginChat}
            >
              <PlusIcon className="mr-1.5 size-3.5" />
              {t.common.create}
            </Button>
          </div>

          {filteredPluginEntries.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
              {filteredPluginEntries.map((entry) => (
                <PluginListItem
                  key={`${entry.source}-${entry.plugin.id}`}
                  entry={entry}
                  onConfigure={setConfigTarget}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 px-6 py-12 text-center">
              <PuzzleIcon className="mx-auto mb-3 size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {pluginEntries.length === 0
                  ? t.plugins.emptyTitle
                  : t.plugins.noMatches}
              </p>
              <p className="mt-1 text-ui text-muted-foreground">
                {pluginEntries.length === 0
                  ? t.plugins.emptyHint
                  : t.plugins.tryDifferentQuery}
              </p>
            </div>
          )}

          {configTarget && (
            <HubPluginConfigDialog
              plugin={configTarget}
              open={true}
              onOpenChange={(open) => {
                if (!open) setConfigTarget(null);
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Kept as a compatibility implementation while legacy callers migrate to
// AppMarketplacePanel. It is intentionally not rendered by the HUB surface.
void PluginsTabContent;

// ---------------------------------------------------------------------------
// Main Unified Component
// ---------------------------------------------------------------------------

// Hub shows all available agents (installed + installable).
