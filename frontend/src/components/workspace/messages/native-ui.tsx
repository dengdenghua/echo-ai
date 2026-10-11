import type { Message } from "@/core/api/types";
import { useContext, useId, useRef, useState } from "react";

import { getBackendBaseURL } from "@/core/config";
import { useNativeUICopy } from "@/core/messages/native-ui-copy";
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
  const copy = useNativeUICopy();
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
          aria-label={`${copy.filter}${block.title}`}
          placeholder={copy.filterPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div
        className="overflow-x-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label={`${block.title}${copy.comparison}`}
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
          <p className="p-3 text-sm text-muted-foreground">{copy.noMatches}</p>
        )}
      </div>
    </section>
  );
}

function TaskPlan({ title }: { title: string }) {
  const copy = useNativeUICopy();
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
            {copy.planCompleted} {completed}/{todos.length}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{copy.planHint}</p>
      {!todos.length ? (
        <p className="text-sm text-muted-foreground">{copy.noTasks}</p>
      ) : (
        <>
          <progress
            className="h-1.5 w-full accent-primary"
            aria-label={copy.planProgress}
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
                    ? copy.done
                    : ["in_progress", "working"].includes(todo.status)
                      ? copy.working
                      : copy.pending}
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
  const copy = useNativeUICopy();
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
          text: formReply(block, previous.values, copy),
          clientMessageId,
        });
        if (!accepted) {
          update(previous);
          setNotice(copy.unavailable);
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
                  <span className="ml-1 text-muted-foreground">
                    {copy.required}
                  </span>
                )}
              </label>
              {field.type === "select" ? (
                <select {...props}>
                  <option value="">{copy.select}</option>
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
            ? copy.received
            : failed
              ? copy.failed
              : state.clientMessageId
                ? copy.waiting
                : copy.send}
        </button>
        <p className="text-xs text-muted-foreground" role="status">
          {received
            ? copy.receivedHint
            : failed
              ? copy.failedHint
              : state.clientMessageId
                ? copy.waitingHint
                : !complete
                  ? copy.preparingForm
                  : copy.replyHint}
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
                text: formReply(block, state.values, copy),
                clientMessageId: state.clientMessageId,
              });
              setNotice(accepted ? copy.retrying : copy.unavailable);
            }}
          >
            {copy.retry}
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
  const copy = useNativeUICopy();
  const meta = useContext(ThreadMetaContext);
  const auth = useOptionalAuth();
  const actor = auth?.user?.actor_id || auth?.user?.user_id;
  const storageScope = actor
    ? JSON.stringify([
        getBackendBaseURL(),
        new URL(window.location.href).searchParams.get("echoRemote"),
        actor,
        meta?.threadId,
      ])
    : null;
  const cards: React.ReactNode[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.type !== "ai") continue;
    for (const call of message.tool_calls ?? []) {
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
                {copy.preparing}
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
