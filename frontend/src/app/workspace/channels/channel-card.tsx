// One channel tile on the channels page: platform glyph, connection badge,
// pairing metrics, health line, responder binding and credential action.

import {
  BellIcon,
  BellRingIcon,
  BotIcon,
  BriefcaseIcon,
  ChevronRightIcon,
  FeatherIcon,
  Gamepad2Icon,
  GemIcon,
  GlobeIcon,
  Grid3x3Icon,
  HashIcon,
  HouseIcon,
  KeyRoundIcon,
  LockIcon,
  type LucideIcon,
  MailIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  PhoneIcon,
  PlugIcon,
  PlusIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  SendIcon,
  SettingsIcon,
  SmartphoneIcon,
  TerminalIcon,
  TvIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { RoutedWebLink } from "@/components/ui/routed-web-link";
import { StatusBadge } from "@/components/ui/state";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type { AgentLite, ChannelRow, GroupLite } from "./channels-model";

// Platform glyphs: lucide line icons on one neutral tile (BRAND.md: no
// emoji as icons, no per-platform brand colours). Connection state is
// carried by the status badge and the top rule, not by the tile.
const PLATFORM_ICONS: Record<string, LucideIcon> = {
  wechat: MessageCircleIcon,
  dingtalk: BellRingIcon,
  feishu: FeatherIcon,
  telegram: SendIcon,
  slack: HashIcon,
  discord: Gamepad2Icon,
  signal: LockIcon,
  whatsapp: PhoneIcon,
  email: MailIcon,
  sms: MessageSquareTextIcon,
  mattermost: RadioTowerIcon,
  matrix: Grid3x3Icon,
  wecom: BriefcaseIcon,
  qqbot: BotIcon,
  teams: UsersIcon,
  line: MessagesSquareIcon,
  homeassistant: HouseIcon,
  bluebubbles: SmartphoneIcon,
  ntfy: BellIcon,
  webhooks: WebhookIcon,
  google_chat: MessageSquareIcon,
  simplex: KeyRoundIcon,
  open_webui: GlobeIcon,
  yuanbao: GemIcon,
  irc: TerminalIcon,
  twitch: TvIcon,
  other: PlugIcon,
};

export function ChannelCard({
  row,
  agents,
  groups,
  onRequestAssign,
  onRequestCredential,
  onRequestPairings,
  onRequestHealthCheck,
  probing,
}: {
  row: ChannelRow;
  agents: AgentLite[];
  groups: GroupLite[];
  onRequestAssign: () => void;
  onRequestCredential: () => void;
  onRequestPairings: () => void;
  onRequestHealthCheck: () => void;
  probing: boolean;
}) {
  const { t } = useI18n();
  const PlatformIcon = PLATFORM_ICONS[row.platform] ?? PlugIcon;
  const assignedAgent = agents.find((a) => a.id === row.assigned_agent_id);
  const assignedGroup = groups.find(
    (group) => group.group_id === row.assigned_group_id,
  );
  const hasAssignment = Boolean(row.assigned_agent_id || row.assigned_group_id);

  return (
    <div
      className={cn(
        "workspace-panel ui-density-panel group relative overflow-hidden rounded-lg border bg-background/60",
        "transition-colors hover:border-border-strong",
        row.connected ? "border-success/20" : "border-border-default",
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1",
          row.connected ? "bg-success/55" : "bg-muted",
        )}
      />
      {/* Implementation note. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            data-platform-icon={row.platform}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-default bg-muted/60",
              row.connected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <PlatformIcon className="size-5" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-5">
              {row.display_name}
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {row.description}
              {row.help_url && !row.connected && (
                <RoutedWebLink
                  href={row.help_url}
                  openTargetSource="channel-help"
                  className="ml-1 whitespace-nowrap text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer"
                  onClick={(e) => {
                    if (!row.help_url || row.help_url === "#") {
                      e.preventDefault();
                      toast.info(t.channels.helpDocsComingSoon);
                    }
                  }}
                >
                  {t.channels.howToSetup}
                </RoutedWebLink>
              )}
            </div>
          </div>
        </div>
        <StatusBadge
          tone={row.connected ? "success" : "idle"}
          className="h-6 shrink-0 rounded-full px-2 text-xs"
        >
          {row.connected ? t.channels.connectedBadge : t.channels.notLinked}
        </StatusBadge>
      </div>

      {/* Implementation note. */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric
          label={t.channels.pairedUsers}
          value={row.metrics.pairings_count}
          onClick={row.connected ? onRequestPairings : undefined}
        />
        <Metric
          label={t.channels.pairedGroups}
          value={row.metrics.group_count}
          onClick={row.connected ? onRequestPairings : undefined}
        />
        <Metric
          label={t.channels.pendingRequests}
          value={row.metrics.pending_count}
          onClick={row.connected ? onRequestPairings : undefined}
        />
      </div>

      {row.connected && (
        <div className="mt-3 rounded-lg border border-border-subtle bg-muted/15 px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                row.operations.health_status === "healthy" && "bg-success",
                row.operations.health_status === "degraded" && "bg-destructive",
                row.operations.health_status === "unsupported" &&
                  "bg-muted-foreground/35",
                row.operations.health_status === "unknown" &&
                  "bg-muted-foreground/35",
              )}
            />
            <span className="font-medium">
              {row.operations.health_status === "healthy"
                ? t.channels.healthHealthy
                : row.operations.health_status === "degraded"
                  ? t.channels.healthDegraded
                  : row.operations.health_status === "unsupported"
                    ? t.channels.healthUnsupported
                    : t.channels.healthUnknown}
            </span>
            <span className="text-muted-foreground">
              {t.channels.activeThreads(row.operations.thread_count)}
              {row.operations.duplicate_count > 0 &&
                ` · ${t.channels.duplicatesBlocked(row.operations.duplicate_count)}`}
              {row.operations.check_latency_ms != null &&
                ` · ${row.operations.check_latency_ms} ms`}
            </span>
            <button
              type="button"
              onClick={onRequestHealthCheck}
              disabled={probing}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              title={t.channels.runHealthCheck}
            >
              <RefreshCwIcon
                className={cn("size-3.5", probing && "animate-spin")}
              />
              {probing ? t.channels.healthChecking : t.channels.runHealthCheck}
            </button>
          </div>
          {row.operations.last_error &&
            row.operations.health_status === "degraded" && (
              <div
                className="mt-1 truncate pl-4 text-xs text-destructive/85"
                title={row.operations.last_error}
              >
                {row.operations.last_error}
              </div>
            )}
        </div>
      )}

      {/* Implementation note. */}
      <div className="mt-3">
        {hasAssignment ? (
          <button
            type="button"
            onClick={onRequestAssign}
            className={cn(
              "group flex w-full items-center justify-between rounded-lg",
              "border border-primary/20 bg-primary/[0.04] px-3 py-2.5 text-left",
              "hover:border-primary/40 hover:bg-primary/[0.08] transition-colors",
            )}
            title={t.channels.clickToChangeAgent}
          >
            <div className="flex items-center gap-2">
              {row.assigned_group_id ? (
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <UsersIcon className="size-3.5" />
                </div>
              ) : assignedAgent?.avatar_url ? (
                <img
                  src={assignedAgent.avatar_url}
                  alt=""
                  className="size-6 rounded-md object-cover"
                />
              ) : (
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-xs font-medium text-primary">
                  {(assignedAgent?.display_name ?? row.assigned_agent_id ?? "?")
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-xs font-medium">
                  {assignedGroup?.display_name ??
                    row.assigned_group_id ??
                    assignedAgent?.display_name ??
                    row.assigned_agent_id}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.assigned_group_id
                    ? t.channels.handlingMessagesAsTeam
                    : t.channels.handlingMessages}
                </div>
              </div>
            </div>
            <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onRequestAssign}
            className={cn(
              "group flex w-full items-center justify-between rounded-lg",
              "border border-dashed border-border-default bg-muted/18 px-3 py-2.5 text-left",
              "hover:border-border hover:bg-muted/40 transition-colors",
            )}
          >
            <div className="flex items-center gap-2">
              <PlusIcon className="size-3.5 text-muted-foreground" />
              <div>
                <div className="text-xs font-medium">
                  {t.channels.configureAgent}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.channels.configureAgentHint}
                </div>
              </div>
            </div>
            <ChevronRightIcon className="size-3.5 text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>

      {/* Implementation note. */}
      <div className="mt-3 flex gap-2 border-t border-border-default pt-3">
        {row.connected ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={onRequestCredential}
          >
            <SettingsIcon className="mr-1.5 size-3" />
            {t.channels.rebindOrUnbind}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={onRequestCredential}
          >
            <SettingsIcon className="mr-1.5 size-3" />
            {t.channels.connectBot}
          </Button>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  /* Implementation note. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </>
  );
  const baseClass = cn(
    "rounded-lg border border-border-subtle bg-background/70",
    "px-2 py-1.5 text-center",
  );
  if (!onClick) {
    return <div className={baseClass}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        baseClass,
        "transition-colors cursor-pointer",
        "hover:border-primary/40 hover:bg-primary/[0.04]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
      )}
      title="点击查看详情"
    >
      {body}
    </button>
  );
}
