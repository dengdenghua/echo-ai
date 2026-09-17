import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  LinkIcon,
  LockKeyholeIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LinkedFileReference } from "./messages/linked-file-reference";

import {
  coordinationRequest,
  type CoordinationSnapshot,
} from "@/core/cowork/coordination";

const statuses: Record<string, string> = {
  pending: "排队中",
  working: "执行中",
  waiting: "等待交付",
  done: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
const terminal = new Set(["done", "failed", "cancelled"]);

export function CollaborationCoordination({
  threadId,
  members,
}: {
  threadId: string;
  members: { id: string; name: string; owner?: string }[];
}) {
  // The keyed child prevents drafts and expanded state leaking between groups.
  return (
    <CoordinationPanel key={threadId} threadId={threadId} members={members} />
  );
}

function CoordinationPanel({
  threadId,
  members,
}: {
  threadId: string;
  members: { id: string; name: string; owner?: string }[];
}) {
  const client = useQueryClient();
  const key = ["coordination", threadId];
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const show = (event: Event) => {
      if ((event as CustomEvent).detail?.threadId === threadId) setExpanded(true);
    };
    window.addEventListener("echo:open-coordination", show);
    return () => window.removeEventListener("echo:open-coordination", show);
  }, [threadId]);
  const taskNodes = useRef(new Map<string, HTMLElement>());
  const [focusedTask, setFocusedTask] = useState<string>();
  const focusTask = (id: string) => {
    setFocusedTask(id);
    taskNodes.current.get(id)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    taskNodes.current.get(id)?.focus({ preventScroll: true });
  };
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [assignee, setAssignee] = useState(members[0]?.id ?? "");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const query = useQuery({
    queryKey: key,
    queryFn: () => coordinationRequest<CoordinationSnapshot>(threadId),
    enabled: threadId !== "new",
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const change = useMutation({
    mutationFn: ({ suffix, body }: { suffix: string; body: unknown }) =>
      coordinationRequest(threadId, suffix, body),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: key });
      if (variables.suffix === "/tasks") {
        setPrompt("");
        setDependencies([]);
        setCreating(false);
        setRequestId(crypto.randomUUID());
      }
    },
  });
  const data = query.data;
  const tasks = data?.tasks ?? [];
  const active = tasks.filter((t) => !terminal.has(t.status));
  const pending = (data?.messages ?? []).filter(
    (m) => m.kind === "handoff" && m.state === "pending",
  );
  const failed = tasks.filter(task => task.status === "failed");
  const blockers = (data?.messages ?? []).filter(m => m.kind !== "handoff" && m.kind !== "message" && m.state === "pending");
  const hasAttention = active.length > 0 || pending.length > 0 || failed.length > 0 || blockers.length > 0 || (data?.resources.length ?? 0) > 0;
  const memberName = (id: string) =>
    members.find((m) => m.id === id)?.name ?? id;
  const taskName = (id: string) =>
    tasks.find((t) => t.id === id)?.title ?? "关联任务";
  const resourceNames: Record<string, string> = {
    "device:desktop": "电脑控制",
    "browser:control": "浏览器控制",
  };
  const resourceName = (id: string) => resourceNames[id] ?? id;
  const canAct = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    return (
      data?.can_write !== false &&
      task &&
      (task.actor_id === data?.actor_id ||
        members.find((m) => m.id === task.member_id)?.owner === data?.actor_id)
    );
  };
  if (!expanded && !hasAttention && !query.isError) return null;
  return (
    <section
      className="mt-2 rounded-lg border border-border/60 bg-background text-xs"
      aria-label="任务协作"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        aria-label="任务协作"
        onClick={() => setExpanded(!expanded)}
      >
        <LinkIcon className="size-3.5" />
        <span className="truncate">
          {[
            active.length ? `${active.length} 项进行中` : "",
            pending.length ? `${pending.length} 项待交接` : "",
            failed.length ? `${failed.length} 项失败待查看` : "",
            blockers.length ? `${blockers.length} 项阻塞待处理` : "",
          ].filter(Boolean).join(" · ") || (query.isError ? "协作记录暂不可用" : (data?.resources.length ?? 0) > 0 ? "协作资源使用中" : "协作记录")}
        </span>
        {(data?.resources.length ?? 0) > 0 && (
          <LockKeyholeIcon className="size-3.5" aria-label="有资源正在使用" />
        )}
        <ChevronDownIcon
          className={`ml-auto size-3.5 ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="max-h-80 space-y-3 overflow-auto border-t p-3">
          <p className="text-muted-foreground">
            三个参与模式共用任务与交接记录。协作消息不会扩大任务权限。
          </p>
          {query.isPending && <p role="status">正在读取协作记录…</p>}
          {query.isError && (
            <div role="alert">
              协作记录暂不可用{" "}
              <button
                className="underline"
                onClick={() => void query.refetch()}
              >
                重新加载
              </button>
            </div>
          )}
          {data?.resources.map((r) => (
            <p
              key={r.resource}
              className="flex items-center gap-1 text-amber-600"
            >
              <LockKeyholeIcon className="size-3" />
              {resourceName(r.resource)} 正在使用 · <button className="underline" onClick={() => focusTask(r.task_id)}>{taskName(r.task_id)}</button>
            </p>
          ))}
          {tasks.map((task) => (
            <article key={task.id} tabIndex={-1} ref={node => { if (node) taskNodes.current.set(task.id, node); else taskNodes.current.delete(task.id); }} className={`rounded-md border p-2 ${focusedTask === task.id ? "ring-2 ring-primary/40" : ""}`}>
              <div className="flex items-center gap-2">
                <span
                  className="line-clamp-2 min-w-0 flex-1 break-words font-medium"
                  title={task.title}
                >
                  {task.title}
                </span>
                <span
                  className={
                    task.status === "failed"
                      ? "text-destructive"
                      : "shrink-0 text-muted-foreground"
                  }
                >
                  {statuses[task.status] ?? task.status}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {memberName(task.member_id)} · 发起人 {task.actor_id}
              </p>
              {task.waiting_for.length > 0 && (
                <p className="mt-1 text-amber-600">
                  等待：{task.waiting_for.map(taskName).join("、")}
                </p>
              )}
              {task.result && (
                <details className="mt-1">
                  <summary className="cursor-pointer">查看结果</summary>
                  <p className="whitespace-pre-wrap break-words pt-1">
                    {task.result}
                  </p>
                </details>
              )}
              {task.background !== false &&
                !terminal.has(task.status) &&
                canAct(task.id) && (
                  <button
                    className="mt-1 text-muted-foreground underline"
                    disabled={change.isPending}
                    onClick={() =>
                      change.mutate({
                        suffix: "/receipt",
                        body: { task_id: task.id, action: "cancel" },
                      })
                    }
                  >
                    取消任务
                  </button>
                )}
            </article>
          ))}
          {(data?.messages ?? [])
            .filter((m) => m.kind !== "message")
            .map((m) => (
              <article key={m.id} className="rounded-md border p-2">
                <p className="font-medium">
                  {m.kind === "handoff" ? "任务交接" : "遇到阻塞"} ·{" "}
                  {m.state === "acknowledged" ? "已接收" : "待接收"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  来自 <button className="underline" onClick={() => focusTask(m.source_id)}>{taskName(m.source_id)}</button> → <button className="underline" onClick={() => focusTask(m.target_id)}>{taskName(m.target_id)}</button>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                {m.artifacts.map((a, i) => (
                  <div
                    key={i}
                    className="mt-2 border-l-2 pl-2 text-muted-foreground"
                  >
                    <p className="break-all">
                      <LinkedFileReference path={a.path} /> · {a.version}
                    </p>
                    <p>交付方验证说明：{a.verification}</p>
                  </div>
                ))}
                {m.state === "pending" && canAct(m.target_id) && (
                  <button
                    className="mt-2 rounded border px-2 py-1"
                    disabled={change.isPending}
                    onClick={() =>
                      change.mutate({
                        suffix: "/receipt",
                        body: {
                          task_id: m.target_id,
                          message_id: m.id,
                          action: "acknowledge",
                        },
                      })
                    }
                  >
                    确认接收
                  </button>
                )}
              </article>
            ))}
          {data?.messages.some((m) => m.kind === "message") && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                成员协调消息
              </summary>
              {data.messages
                .filter((m) => m.kind === "message")
                .map((m) => (
                  <p
                    key={m.id}
                    className="mt-2 whitespace-pre-wrap break-words"
                  >
                    {taskName(m.source_id)} → {taskName(m.target_id)}：{m.body}
                  </p>
                ))}
            </details>
          )}
          {data && !tasks.length && (
            <p className="text-muted-foreground">
              还没有协作任务。可为成员安排工作，并指定需要等待的交付。
            </p>
          )}
          {data && !data.runner_enabled && (
            <p role="status" className="text-amber-600">
              后台执行器暂不可用，恢复后才能安排新任务。
            </p>
          )}
          {!creating ? (
            <button
              className="flex items-center gap-1 rounded border px-2 py-1"
              disabled={
                !data?.runner_enabled ||
                data?.can_write === false ||
                !members.length
              }
              onClick={() => {
                setAssignee(members[0]?.id ?? "");
                setCreating(true);
              }}
            >
              <PlusIcon className="size-3" />
              安排任务
            </button>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                change.mutate({
                  suffix: "/tasks",
                  body: {
                    assignee,
                    prompt,
                    request_id: requestId,
                    dependencies,
                  },
                });
              }}
            >
              <label className="block">
                执行成员
                <select
                  className="ml-2 rounded border bg-background p-1"
                  aria-label="执行成员"
                  value={assignee}
                  onChange={(e) => {
                    setAssignee(e.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                className="w-full resize-y rounded border bg-background p-2"
                required
                maxLength={12000}
                aria-label="任务要求"
                placeholder="描述具体工作和交付要求"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setRequestId(crypto.randomUUID());
                }}
              />
              {tasks.filter((t) => !["failed", "cancelled"].includes(t.status))
                .length > 0 && (
                <fieldset>
                  <legend>等待这些任务完成（可选）</legend>
                  {tasks
                    .filter((t) => !["failed", "cancelled"].includes(t.status))
                    .map((t) => (
                      <label key={t.id} className="mt-1 flex gap-2">
                        <input
                          type="checkbox"
                          checked={dependencies.includes(t.id)}
                          onChange={(e) => {
                            setDependencies(
                              e.target.checked
                                ? [...dependencies, t.id]
                                : dependencies.filter((id) => id !== t.id),
                            );
                            setRequestId(crypto.randomUUID());
                          }}
                        />
                        <span className="truncate">{t.title}</span>
                      </label>
                    ))}
                </fieldset>
              )}
              <div className="flex gap-2">
                <button
                  className="rounded bg-primary px-2 py-1 text-primary-foreground"
                  disabled={
                    change.isPending ||
                    !prompt.trim() ||
                    !assignee ||
                    data?.can_write === false ||
                    !data?.runner_enabled
                  }
                >
                  开始任务
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => setCreating(false)}
                >
                  收起
                </button>
              </div>
            </form>
          )}
          {change.isError && (
            <p role="alert" className="text-destructive">
              {change.error.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
