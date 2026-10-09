import { useState } from "react";
import {
  ListTodoIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { useI18n } from "@/core/i18n/hooks";
import type {
  MessageQueueControl,
  QueuedMessage,
} from "@/core/threads/use-message-queue";

const actionClass =
  "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";

export function MessageQueuePanel({ queue }: { queue: MessageQueueControl }) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  if (!queue.items.length) return null;
  return (
    <section
      data-testid="message-queue"
      aria-label={zh ? "待发送队列" : "Message queue"}
      className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-muted/20"
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <ListTodoIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium">
          {zh ? "待发送" : "Queued"} · {queue.items.length}
        </span>
        <span className="text-muted-foreground">
          {queue.paused
            ? zh
              ? "已暂停"
              : "Paused"
            : zh
              ? "按顺序发送"
              : "In order"}
        </span>
        <button
          type="button"
          onClick={queue.paused ? queue.resume : queue.pause}
          className={`${actionClass} ml-auto inline-flex items-center gap-1`}
        >
          {queue.paused ? (
            <PlayIcon className="size-3" />
          ) : (
            <PauseIcon className="size-3" />
          )}
          {queue.paused
            ? zh
              ? "继续队列"
              : "Resume queue"
            : zh
              ? "暂停队列"
              : "Pause queue"}
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto border-t border-border/50">
        {queue.items.map((item) => (
          <QueueRow key={item.id} item={item} queue={queue} zh={zh} />
        ))}
      </div>
      <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
        {queue.storageUnavailable
          ? zh
            ? "无法保存队列，关闭或刷新页面会丢失待发送消息"
            : "Queue could not be saved. Closing or reloading this page will lose it."
          : zh
            ? "仅保存于当前窗口；刷新后暂停，等待你继续"
            : "Saved in this window; paused after reload until you resume"}
      </p>
    </section>
  );
}

function QueueRow({
  item,
  queue,
  zh,
}: {
  item: QueuedMessage;
  queue: MessageQueueControl;
  zh: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const labels = {
    waiting: zh ? "等待发送" : "Waiting",
    sending: zh ? "等待送达确认" : "Awaiting receipt",
    failed: zh ? "发送失败" : "Send failed",
    uncertain: zh
      ? "送达状态未知，请先检查对话"
      : "Delivery unknown. Check the conversation first",
  };
  return (
    <div
      className="border-b border-border/40 px-3 py-2 last:border-b-0"
      data-queue-state={item.state}
    >
      {editing ? (
        <>
          <textarea
            aria-label={zh ? "编辑待发送消息" : "Edit queued message"}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={100_000}
            className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              className={actionClass}
              onClick={() => {
                setEditing(false);
                setText(item.text);
              }}
            >
              {zh ? "取消" : "Cancel"}
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={!text.trim()}
              onClick={() => {
                if (queue.edit(item.id, text)) setEditing(false);
              }}
            >
              {zh ? "保存" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
            {item.text}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`mr-auto inline-flex items-center gap-1 text-[11px] ${item.state === "failed" || item.state === "uncertain" ? "text-warning" : "text-muted-foreground"}`}
            >
              {item.state === "sending" ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : null}
              {labels[item.state]}
            </span>
            {item.state === "waiting" || item.state === "failed" ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={actionClass}
              >
                {zh ? "编辑" : "Edit"}
              </button>
            ) : null}
            {item.state === "waiting" && queue.canSteer ? (
              <button
                type="button"
                onClick={() => queue.steer(item.id)}
                className={actionClass}
              >
                {zh ? "补充当前任务" : "Steer now"}
              </button>
            ) : null}
            {item.state === "failed" || item.state === "uncertain" ? (
              <button
                type="button"
                onClick={() => queue.retry(item.id)}
                className={actionClass}
              >
                {item.state === "uncertain"
                  ? zh
                    ? "确认未送达，重试"
                    : "Not delivered — retry"
                  : zh
                    ? "重试"
                    : "Retry"}
              </button>
            ) : null}
            {item.state !== "sending" ? (
              <button
                type="button"
                onClick={() => queue.remove(item.id)}
                className={actionClass}
                aria-label={zh ? "删除待发送消息" : "Delete queued message"}
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          {item.error ? (
            <p
              role="alert"
              className="mt-1 break-words text-xs text-destructive"
            >
              {item.error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
