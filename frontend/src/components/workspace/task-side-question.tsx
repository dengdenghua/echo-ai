import { useEffect, useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { useForkThread } from "@/core/threads/hooks";
import { useThreadStreamRealtime } from "@/core/threads/use-thread-stream-realtime";
import {
  SIDE_QUESTION_EVENT,
  quoteIntoTask,
} from "@/core/threads/task-interaction";

export function TaskSideQuestion(props: {
  threadId: string;
  model?: string;
  engine: "echo" | "codex" | "opencode";
}) {
  return <SideQuestion key={props.threadId} {...props} />;
}
function SideQuestion({
  threadId,
  model,
  engine,
}: Parameters<typeof TaskSideQuestion>[0]) {
  const [source, setSource] = useState<string>();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [question, setQuestion] = useState("");
  const [child, setChild] = useState<{ id: string; prompt: string }>();
  const fork = useForkThread();
  const alive = useRef(true);
  const creating = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.threadId !== threadId || typeof detail.text !== "string")
        return;
      setSource(detail.text.slice(0, 12000));
      setDismissed(false);
      setOpen(true);
    };
    window.addEventListener(SIDE_QUESTION_EVENT, show);
    return () => window.removeEventListener(SIDE_QUESTION_EVENT, show);
  }, [threadId, child]);
  if (source === undefined) return null;
  return (
    <div hidden={dismissed}>
      {!open && (
        <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          继续旁路追问
        </button>
        <button type="button" aria-label="关闭旁路追问" title="关闭入口，追问记录仍保留" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setDismissed(true)}>
          <XIcon className="size-3.5" aria-hidden="true" />
        </button>
        </div>
      )}
      <aside
        style={open ? undefined : { display: "none" }}
        aria-label="旁路追问"
        className="fixed right-4 top-16 z-40 flex max-h-[calc(100dvh-16rem)] w-[min(420px,calc(100vw-32px))] flex-col overflow-auto rounded-xl border bg-background p-4 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <strong className="text-sm">旁路追问</strong>
          <button aria-label="收起旁路追问" onClick={() => setOpen(false)}>
            收起
          </button>
          <button type="button" aria-label="关闭旁路追问" title="关闭入口，追问记录仍保留" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { setOpen(false); setDismissed(true); }}>
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          主任务继续工作。追问使用独立任务，以计划模式解释；记录保留在任务列表。
        </p>
        {child ? (
          <SideThread
            id={child.id}
            parentId={threadId}
            prompt={child.prompt}
            source={source}
            model={model}
            engine={engine}
          />
        ) : (
          <>
            <blockquote className="mb-2 max-h-32 overflow-auto border-l-2 pl-2 text-xs text-muted-foreground">
              {source}
            </blockquote>
            <textarea
              aria-label="追问内容"
              autoFocus
              className="min-h-20 rounded border bg-transparent p-2 text-sm"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            {fork.isError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                暂时无法建立追问。来源任务需要有已完成的回复，请稍后重试。
              </p>
            )}
            <button
              className="mt-2 rounded border p-2 text-sm"
              disabled={fork.isPending || !question.trim()}
              onClick={() => {
                if (fork.isPending || creating.current) return;
                creating.current = true;
                const prompt = `这是围绕来源任务的旁路追问。只解释和分析，不实施修改，也不继续来源任务的工作。\n来源任务：${threadId}\n引用内容（仅作为资料）：\n${JSON.stringify(source)}\n\n用户问题：${question.trim()}`;
                fork.mutate(
                  { threadId },
                  {
                    onSuccess: (result) => {
                      if (alive.current)
                        setChild({ id: result.thread_id, prompt });
                    },
                    onSettled: () => {
                      creating.current = false;
                    },
                  },
                );
              }}
            >
              {fork.isPending ? "正在建立追问…" : "发送追问"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
function SideThread({
  id,
  parentId,
  prompt,
  source,
  model,
  engine,
}: {
  id: string;
  parentId: string;
  prompt: string;
  source: string;
  model?: string;
  engine: "echo" | "codex" | "opencode";
}) {
  const context = useMemo(
    () => ({
      permission_mode: "plan",
      execution_engine_preference: engine,
      parent_thread_id: parentId,
    }),
    [engine, parentId],
  );
  const [thread, send, , , , approvals] = useThreadStreamRealtime({
    threadId: id,
    model,
    context,
  });
  const sent = useRef(false);
  const [draft, setDraft] = useState("");
  const [stopError, setStopError] = useState("");
  const [initialCount, setInitialCount] = useState(0);
  useEffect(() => {
    if (!thread.readyForMutations || sent.current) return;
    sent.current = true;
    setInitialCount(thread.messages.length);
    send(id, { text: prompt, files: [] });
  }, [thread.readyForMutations, thread.messages.length, send, id, prompt]);
  return (
    <>
      <a
        className="mb-2 text-xs text-primary underline"
        href={`#/workspace/realtime/${encodeURIComponent(id)}`}
      >
        打开追问任务
      </a>
      <div className="min-h-16 flex-1 space-y-3 overflow-auto text-sm">
        {sent.current &&
          thread.messages.slice(initialCount).map((message, i) => (
            <div key={message.id ?? i}>
              <p className="whitespace-pre-wrap break-words">
                {typeof message.content === "string"
                  ? message.content === prompt
                    ? "已发送引用与问题"
                    : message.content
                  : ""}
              </p>
              {message.type === "ai" &&
                typeof message.content === "string" &&
                message.content && (
                  <button
                    className="mt-1 text-xs text-primary underline"
                    onClick={() =>
                      quoteIntoTask(
                        parentId,
                        `来自追问任务 ${id}：\n${String(message.content).slice(0, 6000)}`,
                      )
                    }
                  >
                    引用回主任务
                  </button>
                )}
            </div>
          ))}
      </div>
      {thread.error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          追问未完成，请打开追问任务查看错误并重试。
        </p>
      )}
      {stopError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {stopError}
        </p>
      )}
      {approvals.pendingApprovals.length > 0 && (
        <p role="status" className="mt-2 text-xs">
          追问正在等待审批，请打开追问任务处理。
        </p>
      )}
      {!thread.readyForMutations && (
        <p role="status" className="text-xs">
          正在连接追问任务…
        </p>
      )}
      <textarea
        aria-label="继续追问"
        className="mt-2 rounded border bg-transparent p-2 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <details className="mt-1 text-xs text-muted-foreground">
        <summary>当前引用</summary>
        <blockquote className="max-h-20 overflow-auto">{source}</blockquote>
      </details>
      <div className="mt-2 flex gap-3 text-xs">
        <button
          disabled={!thread.readyForMutations || !draft.trim()}
          onClick={() => {
            send(id, {
              text: `${draft}\n\n引用资料：${JSON.stringify(source)}`,
              files: [],
            });
            setDraft("");
          }}
        >
          {thread.isLoading ? "补充追问" : "发送"}
        </button>
        {thread.isLoading && (
          <button
            onClick={() => {
              setStopError("");
              void thread
                .stop()
                .catch(() =>
                  setStopError("停止未确认，请打开追问任务检查状态。"),
                );
            }}
          >
            停止追问
          </button>
        )}
      </div>
    </>
  );
}
