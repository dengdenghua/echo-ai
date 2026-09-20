import {
  FileTextIcon,
  ListTodoIcon,
  MessageSquareIcon,
  RadioIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import {
  useCollabSession,
  useCoworkGroup,
  useCoworkSearch,
  useMarkCoworkRead,
} from "@/core/cowork/hooks";
import { useOptionalCollab } from "@/components/workspace/collab/collab-provider";
import type {
  CoworkMemberPresence,
  CoworkSearchHit,
  CoworkSearchKind,
} from "@/core/cowork/types";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useI18n>["t"];

const KIND_ICON: Record<CoworkSearchKind, typeof FileTextIcon> = {
  blackboard: FileTextIcon,
  task: ListTodoIcon,
  event: UsersIcon,
  room_message: MessageSquareIcon,
  room_task: ListTodoIcon,
};

function kindLabel(kind: CoworkSearchKind, t: T): string {
  if (kind === "blackboard") return t.coworkCollab.kindBlackboard;
  if (kind === "task") return t.coworkCollab.kindTask;
  if (kind === "room_message") return t.coworkCollab.kindRoomMessage;
  if (kind === "room_task") return t.coworkCollab.kindRoomTask;
  return t.coworkCollab.kindEvent;
}

/** Presence for the dedicated collaboration view, not the workbench toolbar. */
export function PresenceDots({ members, seatNames = {}, t }: {
  members: CoworkMemberPresence[];
  seatNames?: Record<string, string>;
  t: T;
}) {
  if (members.length === 0) return null;
  const online = members.filter(member => member.online).length;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="cowork-presence">
      <div className="flex items-center -space-x-0.5">
        {members.slice(0, 6).map(member => (
          <span key={member.member_id}
            title={`${seatNames[member.member_id] ?? member.member_id}${member.online ? ` · ${t.coworkCollab.online}` : ""}`}
            className={cn("relative inline-flex size-2.5 rounded-full ring-2 ring-background", member.online ? "bg-success" : "bg-muted-foreground/35")} />
        ))}
        {members.length > 6 && <span className="pl-1.5 text-xs text-muted-foreground">+{members.length - 6}</span>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{online} {t.coworkCollab.online}</span>
    </div>
  );
}

/** Pure results list, grouped visually by per-hit kind. */
export function SearchHitList({ hits, t }: { hits: CoworkSearchHit[]; t: T }) {
  if (hits.length === 0) {
    return (
      <div className="px-1 py-3 text-center text-xs text-muted-foreground">
        {t.coworkCollab.noResults}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1" data-testid="cowork-search-results">
      {hits.map((hit, i) => {
        const Icon = KIND_ICON[hit.kind] ?? FileTextIcon;
        return (
          <li
            key={`${hit.kind}-${i}`}
            className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
          >
            <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium text-foreground">
                  {hit.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {kindLabel(hit.kind, t)}
                </span>
              </div>
              {hit.snippet && (
                <p className="truncate text-xs text-muted-foreground">
                  {hit.snippet}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Cowork group collab bar for the workbench: replayable search and actionable takeover status. */
export function CoworkSearchMenu({
  threadId,
  className,
}: {
  threadId: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const session = useCollabSession(threadId, { live: true });
  const search = useCoworkSearch(threadId, query);
  const collabTransport = useOptionalCollab();
  const markRead = useMarkCoworkRead();
  const lastMarkedSeq = useRef(0);

  const group = useCoworkGroup(threadId);
  const takeoverCount = group.data?.state.takeover_ids?.length ?? 0;


  const collab = session.data;
  const trimmed = query.trim();

  const latestMessageSeq = Math.max(
    0,
    ...(collab?.room_messages ?? []).map((message) => Number(message.seq) || 0),
  );
  useEffect(() => {
    const memberId = collabTransport?.currentUser?.id;
    if (!memberId || latestMessageSeq <= lastMarkedSeq.current) return;
    lastMarkedSeq.current = latestMessageSeq;
    markRead.mutate({ threadId, memberId, messageSeq: latestMessageSeq });
  }, [collabTransport?.currentUser?.id, latestMessageSeq, markRead, threadId]);

  if (!threadId) return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      {takeoverCount > 0 && (
        <span data-testid="cowork-takeover-indicator" className="flex items-center gap-1 text-[11px] text-amber-600" title={`${takeoverCount} 位真人接管`}>
          <RadioIcon className="size-3" />{takeoverCount}
        </span>
      )}
      <DropdownMenu modal={false} onOpenChange={open => { if (!open) setQuery(""); }}>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="cowork-search-trigger" aria-label={t.coworkCollab.searchPlaceholder} title={t.coworkCollab.searchPlaceholder}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground data-[state=open]:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <SearchIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={8} collisionPadding={12}
          className="w-80 max-w-[calc(100vw-24px)] p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}
              placeholder={t.coworkCollab.searchPlaceholder} aria-label={t.coworkCollab.searchPlaceholder}
              className="h-8 w-full rounded-md border border-border-default bg-background pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
          {trimmed.length > 0 && (
            <div className="mt-1.5 max-h-64 overflow-y-auto">
              {search.isLoading ? <div className="py-3 text-center text-xs text-muted-foreground">…</div> : <SearchHitList hits={search.data?.hits ?? []} t={t} />}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
