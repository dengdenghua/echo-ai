import type { AIMessage, Message } from "@/core/api/types";
import { useContext, useId, useRef, useState } from "react";

import { getBackendBaseURL } from "@/core/config";
import { executionStorageKey } from "@/core/execution-location";
import {
  formReply,
  formValue,
  parseUIReceipt,
  previewUIDocument,
  readUIFormState,
  saveUIFormState,
  type UIComparison,
  type UIForm,
} from "@/core/messages/native-ui";
import { dispatchQuickReply } from "@/core/messages/quick-reply";
import { findToolCallResult } from "@/core/messages/utils";
import { useOptionalAuth } from "@/providers/AuthProvider";

import {
  ThreadMessagesContext,
  ThreadMetaContext,
  ThreadValuesContext,
} from "./context";

const control =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

function Comparison({ block }: { block: UIComparison }) {
  const [query, setQuery] = useState("");
  const rows = block.rows.filter((row) =>
    row.some((cell) =>
      cell.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  );
  return (
    <section className="space-y-3" aria-label={block.title}>
      <h4 className="font-medium">{block.title}</h4>
      {block.rows.length > 4 && (
        <input
          className={control}
          type="search"
          aria-label={`筛选${block.title}`}
          placeholder="筛选方案…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div
        className="overflow-x-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label={`${block.title}对比表`}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {block.columns.map((column, index) => (
                <th
                  key={index}
                  scope="col"
                  className="min-w-28 px-3 py-2 font-medium"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="max-w-64 whitespace-pre-wrap break-words px-3 py-2 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-3 text-sm text-muted-foreground">没有匹配的方案</p>
        )}
      </div>
    </section>
  );
}

function TaskPlan({ title }: { title: string }) {
  const todos = useContext(ThreadValuesContext)?.values.todos ?? [];
  const completed = todos.filter((todo) =>
    ["completed", "done"].includes(todo.status),
  ).length;
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium">{title}</h4>
        {todos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            计划完成 {completed}/{todos.length}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        来自当前对话的任务清单；计划状态不代表执行验收。
      </p>
      {!todos.length ? (
        <p className="text-sm text-muted-foreground">暂无任务记录</p>
      ) : (
        <>
          <progress
            className="h-1.5 w-full accent-primary"
            aria-label="计划进度"
            value={completed}
            max={todos.length}
          />
          <ul className="space-y-2">
            {todos.map((todo, index) => (
              <li
                key={todo.id ?? index}
                className="flex items-start gap-2 text-sm"
              >
                <span className="shrink-0 text-muted-foreground">
                  {["done", "completed"].includes(todo.status)
                    ? "已完成"
                    : ["in_progress", "working"].includes(todo.status)
                      ? "进行中"
                      : "待处理"}
                </span>
                <span className="min-w-0 break-words">{todo.content}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ResponseForm({
  block,
  threadId,
  complete,
  storageKey,
}: {
  block: UIForm;
  threadId: string;
  complete: boolean;
  storageKey: string | null;
}) {
  const inputId = useId();
  const schema = JSON.stringify(block);
  const [state, setState] = useState(() => readUIFormState(storageKey, schema));
  const restoredPending = useRef(!!state.clientMessageId);
  const stateRef = useRef(state);
  const [notice, setNotice] = useState("");
  const messages = useContext(ThreadMessagesContext)?.messages ?? [];
  const delivery = state.clientMessageId
    ? messages.find(
        (message) =>
          message.type === "human" && message.id === state.clientMessageId,
      )
    : undefined;
  const received = !!delivery && !delivery.additional_kwargs?.delivery_state;
  const failed = delivery?.additional_kwargs?.delivery_state === "failed";
  const locked = !complete || !!state.clientMessageId;
  function update(next: typeof state) {
    stateRef.current = next;
    saveUIFormState(storageKey, schema, next);
    setState(next);
  }
  return (
    <form
      className="space-y-3"
      aria-label={block.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || stateRef.current.clientMessageId) return;
        const previous = stateRef.current;
        const clientMessageId = `ui-${crypto.randomUUID()}`;
        update({ ...previous, clientMessageId });
        const accepted = dispatchQuickReply({
          threadId,
          text: formReply(block, previous.values),
          clientMessageId,
        });
        if (!accepted) {
          update(previous);
          setNotice(
            "暂时无法发送，请等待当前回复结束，并确认你可以在此对话发言。填写内容已保留。",
          );
        } else setNotice("");
      }}
    >
      <h4 className="font-medium">{block.title}</h4>
      <fieldset disabled={locked} className="space-y-3">
        {block.fields.map((field) => {
          const props = {
            id: `${inputId}-${field.id}`,
            required: field.required,
            value: formValue(state.values, field.id),
            className: control,
            onChange: (
              event: React.ChangeEvent<
                HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
              >,
            ) =>
              update({
                values: {
                  ...stateRef.current.values,
                  [field.id]: event.target.value,
                },
              }),
          };
          return (
            <div key={field.id} className="space-y-1.5">
              <label htmlFor={props.id} className="block text-sm">
                {field.label}
                {field.required && (
                  <span className="ml-1 text-muted-foreground">（必填）</span>
                )}
              </label>
              {field.type === "select" ? (
                <select {...props}>
                  <option value="">请选择</option>
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea {...props} rows={3} maxLength={2000} />
              ) : (
                <input {...props} type="text" maxLength={2000} />
              )}
            </div>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={locked}
          className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {received
            ? "已收到"
            : failed
              ? "发送失败"
              : state.clientMessageId
                ? "等待回执"
                : "发送到当前对话"}
        </button>
        <p className="text-xs text-muted-foreground" role="status">
          {received
            ? "你的填写已保存到对话。"
            : failed
              ? "发送失败，请在对话中的失败消息上重试。"
              : state.clientMessageId
                ? "正在确认是否收到，请勿重复发送。刷新后会继续核对。"
                : !complete
                  ? "正在准备表单…"
                  : "填写内容将作为你的消息发送。"}
        </p>
      </div>
      {restoredPending.current &&
        state.clientMessageId &&
        !received &&
        (!delivery || failed) && (
          <button
            type="button"
            className="text-sm underline underline-offset-4"
            onClick={() => {
              // Reuse the original id: realtime turn startup reconciles it with
              // the durable log, including across refreshes/server restarts.
              const accepted = dispatchQuickReply({
                threadId,
                text: formReply(block, state.values),
                clientMessageId: state.clientMessageId,
              });
              setNotice(
                accepted
                  ? "正在重新确认发送结果。"
                  : "当前暂时无法发送，填写内容已保留。",
              );
            }}
          >
            重试发送
          </button>
        )}
      {notice && (
        <p role="alert" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </form>
  );
}

export function NativeUIMessages({ messages }: { messages: Message[] }) {
  const meta = useContext(ThreadMetaContext);
  const auth = useOptionalAuth();
  const actor = auth?.user?.actor_id || auth?.user?.user_id;
  const storageScope = actor
    ? executionStorageKey(
        JSON.stringify([getBackendBaseURL(), actor, meta?.threadId]),
      )
    : null;
  const cards: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.type !== "ai") continue;
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (call.name !== "show_ui" || !call.id || seen.has(call.id)) continue;
      seen.add(call.id);
      const result = findToolCallResult(call.id, messages);
      const receipt = parseUIReceipt(result, call.args?.document);
      if (result && !receipt) continue;
      // Never render a receipt from another conversation, including private member chats.
      if (receipt && receipt.thread_id !== meta?.threadId) continue;
      const document =
        receipt?.document ?? previewUIDocument(call.args?.document);
      if (!document) continue;
      cards.push(
        <article
          key={call.id}
          className="my-3 min-w-0 space-y-4 rounded-xl border bg-background p-4 text-foreground"
          aria-label={document.title}
          data-native-ui="v1"
        >
          <header className="flex items-center justify-between gap-3">
            <h3 className="min-w-0 break-words font-semibold">
              {document.title}
            </h3>
            {!receipt && (
              <span
                className="shrink-0 text-xs text-muted-foreground"
                role="status"
              >
                正在准备…
              </span>
            )}
          </header>
          {document.blocks.map((block) =>
            block.type === "text" ? (
              <p
                key={block.id}
                className="whitespace-pre-wrap break-words text-sm leading-relaxed"
              >
                {block.text}
              </p>
            ) : block.type === "comparison" ? (
              <Comparison key={block.id} block={block} />
            ) : block.type === "tasks" ? (
              <TaskPlan key={block.id} title={block.title} />
            ) : (
              <ResponseForm
                key={`${storageScope}:${block.id}:${JSON.stringify(block)}`}
                block={block}
                threadId={receipt?.thread_id ?? ""}
                complete={!!receipt && !meta?.isMock}
                storageKey={
                  storageScope
                    ? `echo.ui.v1:${storageScope}:${call.id}:${block.id}`
                    : null
                }
              />
            ),
          )}
        </article>,
      );
    }
  }
  return <>{cards}</>;
}
