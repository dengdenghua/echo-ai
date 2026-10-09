import { useEffect, useRef, useState } from "react";
import {
  FOLLOWUP_EVENT,
  PAUSE_FOLLOWUPS_EVENT,
  STEER_RECEIPT_EVENT,
} from "@/core/threads/task-interaction";

import { executionStorageKey } from "@/core/execution-location";

type Entry = { id: string; text: string };
export function TaskFollowups(props: {
  threadId: string;
  running: boolean;
  ready: boolean;
  failed: boolean;
  onSend: (message: { text: string }) => void | boolean;
}) {
  return <Followups key={props.threadId} {...props} />;
}

function Followups({
  threadId,
  running,
  ready,
  failed,
  onSend,
}: Parameters<typeof TaskFollowups>[0]) {
  const storageKey = executionStorageKey(`echo:followups:${threadId}`);
  const [entries, setEntries] = useState<Entry[]>(() => {
    try {
      const value: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "[]",
      );
      return Array.isArray(value)
        ? value
            .filter(
              (e): e is Entry =>
                typeof e?.id === "string" && typeof e?.text === "string",
            )
            .slice(0, 20)
        : [];
    } catch {
      return [];
    }
  });
  // Restoring a page never authorizes an unattended send.
  const [paused, setPaused] = useState(entries.length > 0);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [editing, setEditing] = useState<string>();
  const [editText, setEditText] = useState("");
  const entriesRef = useRef(entries);
  const previousRunning = useRef(running);
  const eligible = useRef(false);
  const resumedAfterFailure = useRef(false);
  const save = (next: Entry[]) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setError("无法保存待执行消息，请保留草稿后重试。");
      return false;
    }
    entriesRef.current = next;
    setEntries(next);
    setError("");
    return true;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (failed) {
      setPaused(true);
      eligible.current = false;
      resumedAfterFailure.current = false;
    }
  }, [failed]);
  useEffect(() => {
    const enqueue = (event: Event) => {
      const request = (
        event as CustomEvent<{
          threadId: string;
          text: string;
          accepted: boolean;
        }>
      ).detail;
      if (
        request?.threadId !== threadId ||
        typeof request.text !== "string" ||
        !request.text.trim()
      )
        return;
      if (entriesRef.current.length >= 20) {
        setError("最多保留 20 条待执行消息。");
        return;
      }
      request.accepted = saveRef.current([
        ...entriesRef.current,
        { id: crypto.randomUUID(), text: request.text },
      ]);
    };
    const pause = (event: Event) => {
      if ((event as CustomEvent).detail?.threadId === threadId) {
        setPaused(true);
        eligible.current = false;
      }
    };
    const acknowledge = (event: Event) => {
      if ((event as CustomEvent).detail?.threadId === threadId)
        setReceipt("补充要求已被服务端接收，将在安全节点处理。");
    };
    window.addEventListener(FOLLOWUP_EVENT, enqueue);
    window.addEventListener(PAUSE_FOLLOWUPS_EVENT, pause);
    window.addEventListener(STEER_RECEIPT_EVENT, acknowledge);
    return () => {
      window.removeEventListener(FOLLOWUP_EVENT, enqueue);
      window.removeEventListener(PAUSE_FOLLOWUPS_EVENT, pause);
      window.removeEventListener(STEER_RECEIPT_EVENT, acknowledge);
    };
  }, [threadId]);
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setReceipt(""), 8000);
    return () => clearTimeout(timer);
  }, [receipt]);
  useEffect(() => {
    if (previousRunning.current && !running) eligible.current = true;
    previousRunning.current = running;
    if (
      (failed && !resumedAfterFailure.current) ||
      running ||
      !ready ||
      paused ||
      editing ||
      !eligible.current ||
      !entries.length
    )
      return;
    const entry = entries[0]!;
    // The existing outbound ledger owns delivery errors and retry after this handoff.
    eligible.current = false;
    if (!saveRef.current(entries.slice(1))) {
      setPaused(true);
      return;
    }
    try {
      if (onSend({ text: entry.text }) !== false) return;
    } catch {
      /* Preserve a draft if the mutation boundary rejects it. */
    }
    saveRef.current(entries);
    setPaused(true);
  }, [running, ready, failed, paused, entries, editing, onSend]);
  if (!entries.length && !error && !receipt) return null;
  return (
    <section
      aria-label="追加要求"
      className="mb-2 space-y-2 rounded-lg border px-3 py-2 text-xs"
    >
      {receipt && (
        <p role="status" className="text-muted-foreground">
          {receipt}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {entries.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <span className="flex-1">
              待执行 {entries.length} 条 ·{" "}
              {paused ? "已暂停" : "当前回复结束后依次执行"}
            </span>
            <button
              className="underline"
              disabled={!ready}
              onClick={() => {
                if (paused) {
                  eligible.current = !running;
                  resumedAfterFailure.current = true;
                }
                setPaused(!paused);
              }}
            >
              {paused ? "继续队列" : "暂停队列"}
            </button>
          </div>
          <p className="text-muted-foreground">
            保存在当前标签页；停止任务或重新打开页面后需手动继续。
          </p>
          <ol className="max-h-44 space-y-2 overflow-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                {editing === entry.id ? (
                  <div className="flex-1 space-y-1">
                    <textarea
                      aria-label="修改待执行消息"
                      className="w-full rounded border bg-transparent p-2"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <button
                      className="mr-3 underline"
                      disabled={!editText.trim()}
                      onClick={() => {
                        if (
                          save(
                            entries.map((e) =>
                              e.id === entry.id
                                ? { ...e, text: editText.trim() }
                                : e,
                            ),
                          )
                        )
                          setEditing(undefined);
                      }}
                    >
                      保存
                    </button>
                    <button
                      className="underline"
                      onClick={() => setEditing(undefined)}
                    >
                      取消修改
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words">
                      {entry.text}
                    </p>
                    <button
                      className="underline"
                      onClick={() => {
                        setEditing(entry.id);
                        setEditText(entry.text);
                      }}
                    >
                      修改
                    </button>
                    <button
                      className="underline"
                      onClick={() =>
                        save(entries.filter((e) => e.id !== entry.id))
                      }
                    >
                      移除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
