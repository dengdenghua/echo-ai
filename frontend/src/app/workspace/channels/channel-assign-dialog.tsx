// The "bind a responder" dialog of the channels page: search, then pick an
// AI team or a single agent for one channel, or clear the current binding.
// Presentational — ChannelsPage owns the open state, the query and the
// assign/unassign requests.

import {
  CheckIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type { AgentLite, ChannelRow, GroupLite } from "./channels-model";

export function ChannelAssignDialog({
  open,
  onOpenChange,
  assignRow,
  agents,
  groups,
  assignQuery,
  onAssignQueryChange,
  onAssignGroup,
  onAssignAgent,
  onUnassign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The channel being bound, if it is still in the loaded rows. */
  assignRow: ChannelRow | undefined;
  agents: AgentLite[];
  groups: GroupLite[];
  assignQuery: string;
  onAssignQueryChange: (query: string) => void;
  onAssignGroup: (groupId: string) => void;
  onAssignAgent: (agentId: string) => void;
  onUnassign: (channelId: string) => void;
}) {
  const { t } = useI18n();
  const normalizedAssignQuery = assignQuery.trim().toLowerCase();
  const assignableAgents = normalizedAssignQuery
    ? agents.filter((agent) =>
        [agent.id, agent.display_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedAssignQuery),
      )
    : agents;
  const assignableGroups = normalizedAssignQuery
    ? groups.filter((group) =>
        [
          group.group_id,
          group.display_name,
          group.description,
          ...group.members,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedAssignQuery),
      )
    : groups;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlusIcon className="size-4" />
            {t.channels.assignDialogTitle(assignRow?.display_name ?? "")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t.channels.assignDialogDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={assignQuery}
            onChange={(event) => onAssignQueryChange(event.target.value)}
            placeholder={t.channels.searchRespondersPlaceholder}
            className="h-9 pl-9"
          />
        </div>

        <div className="overflow-y-auto flex-1 mt-2">
          {agents.length === 0 && groups.length === 0 ? (
            <Empty className="min-h-[180px] rounded-lg px-4 py-8">
              <EmptyHeader>
                <EmptyTitle>{t.channels.noAgentsAvailable}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : assignableAgents.length === 0 && assignableGroups.length === 0 ? (
            <Empty className="min-h-[160px] rounded-lg px-4 py-8">
              <EmptyHeader>
                <EmptyTitle>{t.channels.noSearchResults}</EmptyTitle>
                <EmptyDescription>
                  {t.channels.noSearchResultsDescription}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-4">
              {assignableGroups.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                    <UsersIcon className="size-3.5" />
                    {t.channels.aiTeams}
                  </div>
                  <ul className="space-y-1">
                    {assignableGroups.map((group) => {
                      const isCurrent =
                        assignRow?.assigned_group_id === group.group_id;
                      return (
                        <li key={group.group_id}>
                          <button
                            type="button"
                            onClick={() => onAssignGroup(group.group_id)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg border border-border-subtle",
                              "bg-background px-3 py-2 text-left transition-colors",
                              "hover:border-border-strong hover:bg-muted/40",
                              isCurrent && "border-primary/40 bg-primary/5",
                            )}
                          >
                            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                              <UsersIcon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">
                                {group.display_name || group.group_id}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {t.channels.teamMembers(group.members.length)}
                              </div>
                            </div>
                            {isCurrent && (
                              <CheckIcon className="size-4 shrink-0 text-primary" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {assignableAgents.length > 0 && (
                <section>
                  <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                    {t.channels.singleAgents}
                  </div>
                  <ul className="space-y-1">
                    {assignableAgents.map((a, index) => {
                      const isCurrent = assignRow?.assigned_agent_id === a.id;
                      const agentKey =
                        a.id?.trim() || `${a.display_name ?? "agent"}-${index}`;
                      return (
                        <li key={agentKey}>
                          <button
                            type="button"
                            onClick={() => onAssignAgent(a.id)}
                            className={cn(
                              "w-full flex items-center gap-3 rounded-lg border border-border-subtle",
                              "bg-background px-3 py-2 text-left transition-colors",
                              "hover:bg-muted/40 hover:border-border-strong",
                              isCurrent &&
                                "border-primary/40 bg-primary/5 hover:border-primary/60",
                            )}
                          >
                            {a.avatar_url ? (
                              <img
                                src={a.avatar_url}
                                alt=""
                                className="size-8 rounded-md object-cover"
                              />
                            ) : (
                              <div className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                                {(a.display_name ?? a.id)
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {a.display_name || a.id}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {a.id}
                              </div>
                            </div>
                            {isCurrent && (
                              <CheckIcon className="size-4 text-primary shrink-0" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {(assignRow?.assigned_agent_id || assignRow?.assigned_group_id) && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onUnassign(assignRow.channel_id)}
              className="w-full text-xs text-muted-foreground hover:text-destructive"
            >
              <XIcon className="mr-1.5 size-3.5" />
              {t.channels.unassignCurrent}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
