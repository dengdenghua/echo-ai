/**
 * Sidebar run-status lights keyed by thread route — extracted from
 * `workspace-sidebar.tsx`.
 *
 * Merges the active room's team tasks, the polled PauseController tasks, the
 * mounted realtime page's live status (``thread:run-status``) and the unseen
 * attention markers. The live status disappears with its page; the markers
 * keep a thread that failed or started waiting (approval, reply, pause) lit
 * until the user has looked at it.
 */
import { useEffect, useMemo, useState } from "react";

import { useEvent } from "@/core/events";
import { useThreadAttentionMap } from "@/core/notification/attention-store";
import { useTasks } from "@/core/tasks/hooks";
import { useTeamTasks } from "@/core/team-tasks";
import {
  buildThreadRunStatusByHref,
  normalizeThreadRunStatus,
  unseenAttentionStatusByHref,
  type ThreadRunStatus,
} from "@/core/threads/sidebar";

// Safety net for live run-status lights that never got an explicit clear
// (abnormal turn termination, crashed producer). Generous: a long turn
// legitimately streams for many minutes between status events.
const LIVE_RUN_STATUS_TTL_MS = 30 * 60 * 1000;
const LIVE_RUN_STATUS_PRUNE_INTERVAL_MS = 60 * 1000;

export function useThreadRunStatusByHref({
  activeTaskRoomId,
  threadHrefById,
}: {
  activeTaskRoomId: string | null;
  threadHrefById: Map<string, string>;
}): Map<string, ThreadRunStatus> {
  const activeTeamTasksQuery = useTeamTasks(activeTaskRoomId);
  const activeTeamTasks = useMemo(
    () => activeTeamTasksQuery.data ?? [],
    [activeTeamTasksQuery.data],
  );
  const backgroundTasksQuery = useTasks("all");
  // Live run status with a last-touch timestamp. Bare statuses never
  // expire: a turn that terminated without a clearing event (crashed tab,
  // abnormal stream end) left its light stuck on "running" forever. The
  // TTL below is the safety net - page unmount still clears immediately.
  const [liveThreadRunStatusByHref, setLiveThreadRunStatusByHref] = useState<
    Map<string, { status: ThreadRunStatus | "done"; at: number }>
  >(() => new Map());
  useEvent(
    "thread:run-status",
    ({ href, state, threadId }) => {
      const status =
        state === "done" ? "done" : normalizeThreadRunStatus(state);
      const targetHref = href || threadHrefById.get(threadId);
      if (!targetHref) return;
      setLiveThreadRunStatusByHref((prev) => {
        if (
          !status &&
          (!prev.has(targetHref) || prev.get(targetHref)?.status === "done")
        )
          return prev;
        const next = new Map(prev);
        if (status) {
          next.set(targetHref, { status, at: Date.now() });
        } else {
          next.delete(targetHref);
        }
        return next;
      });
    },
    [threadHrefById],
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveThreadRunStatusByHref((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        const next = new Map(prev);
        let changed = false;
        for (const [href, entry] of prev) {
          if (
            entry.status !== "done" &&
            now - entry.at > LIVE_RUN_STATUS_TTL_MS
          ) {
            next.delete(href);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, LIVE_RUN_STATUS_PRUNE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  // Failed / waiting threads the user has not looked at yet keep their light
  // after their page unmounts (see core/notification/attention-store.ts).
  const threadAttention = useThreadAttentionMap();
  return useMemo(
    () =>
      buildThreadRunStatusByHref({
        activeTeamTasks,
        attentionStatusByHref: unseenAttentionStatusByHref(
          threadAttention.values(),
          threadHrefById,
        ),
        backgroundTasks: backgroundTasksQuery.data,
        liveThreadRunStatusByHref: new Map(
          Array.from(liveThreadRunStatusByHref, ([href, entry]) => [
            href,
            entry.status,
          ]),
        ),
        threadHrefById,
      }),
    [
      activeTeamTasks,
      backgroundTasksQuery.data,
      liveThreadRunStatusByHref,
      threadAttention,
      threadHrefById,
    ],
  );
}
