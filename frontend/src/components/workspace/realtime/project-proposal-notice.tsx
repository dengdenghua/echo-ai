import { useQuery } from "@tanstack/react-query";
import { ClipboardCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getAPIClient } from "@/core/api";

/** Keep iterative discovery in the conversation; revising is never approval. */
export function ProjectProposalNotice({
  threadId,
  busy,
  onReview,
}: {
  threadId: string;
  busy: boolean;
  onReview: (command: string) => void;
}) {
  const [submittedId, setSubmittedId] = useState("");
  const [feedback, setFeedback] = useState("");
  const pendingFeedback = useRef<{ id: string; text: string } | null>(null);
  useEffect(() => {
    setFeedback("");
    setSubmittedId("");
    pendingFeedback.current = null;
  }, [threadId]);
  useEffect(() => {
    if (!submittedId) return;
    // Suppress the double-click gap before the live turn becomes busy, but
    // allow another attempt if transport fails before a turn can start.
    const timer = setTimeout(() => setSubmittedId(""), 2000);
    return () => clearTimeout(timer);
  }, [submittedId]);
  const { data } = useQuery({
    queryKey: ["thread", "project-proposal", threadId],
    queryFn: () => getAPIClient().threads.get(threadId),
    enabled: Boolean(threadId) && threadId !== "new" && !busy,
    staleTime: 0,
    retry: false,
  });
  const raw = data?.metadata?.project_initiation;
  useEffect(() => {
    if (!raw || typeof raw !== "object") return;
    const nextId = (raw as { id?: unknown }).id;
    const pending = pendingFeedback.current;
    if (pending && typeof nextId === "string" && pending.id !== nextId) {
      setFeedback((value) => (value.trim() === pending.text ? "" : value));
      pendingFeedback.current = null;
      setSubmittedId("");
    }
  }, [raw]);
  if (busy || !raw || typeof raw !== "object") return null;
  type Brief = {
    name?: unknown;
    scope?: unknown;
    assumptions?: unknown;
    requirements_review?: { understanding?: unknown };
  };
  const draft = raw as {
    id?: unknown;
    status?: unknown;
    revision?: unknown;
    changes?: unknown;
    open_questions?: unknown;
    proposal?: Brief;
    revisions?: { id?: string; revision?: number; proposal?: Brief }[];
  };
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter(
          (item): item is string => typeof item === "string" && !!item.trim(),
        )
      : [];
  const status = String(draft.status);
  if (
    typeof draft.id !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(draft.id) ||
    ![
      "needs_input",
      "needs_review",
      "approval_expired",
      "needs_revision",
      "needs_roles",
      "model_unavailable",
      "review_failed",
      "refining",
    ].includes(status) ||
    typeof draft.proposal?.name !== "string"
  )
    return null;
  const id = draft.id;
  const canReview =
    [
      "needs_review",
      "approval_expired",
      "needs_revision",
      "needs_roles",
    ].includes(status) && strings(draft.open_questions).length === 0;
  function send(command: string) {
    if (submittedId === id) return;
    setSubmittedId(id);
    if (feedback.trim())
      pendingFeedback.current = { id, text: feedback.trim() };
    onReview(command);
  }
  return (
    <div className="mx-auto my-3 flex max-w-3xl items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <ClipboardCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          需求草案 · {draft.proposal.name}
          {typeof draft.revision === "number"
            ? ` · 第 ${draft.revision} 版`
            : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          可以反复补充、纠正或换方向。关键问题解决后再提交立项，修改草案不会启动项目。
        </p>
        {strings(draft.changes).length > 0 && (
          <p className="mt-2 text-xs">
            本轮更新：{strings(draft.changes).join("、")}
          </p>
        )}
        {["model_unavailable", "review_failed", "refining"].includes(
          status,
        ) && (
          <p role="alert" className="mt-2 text-xs">
            本轮评审未完成，原草案和补充意见已保留。可补充后再次更新草案。
          </p>
        )}
        {strings(draft.open_questions).length > 0 && (
          <div className="mt-3">
            <p className="font-medium">先确认这几个问题</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {strings(draft.open_questions)
                .slice(0, 3)
                .map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
            </ol>
          </div>
        )}
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer">查看需求与假设</summary>
          <p className="mt-2">
            {typeof draft.proposal.scope === "string"
              ? draft.proposal.scope
              : ""}
          </p>
          {strings(draft.proposal.requirements_review?.understanding).map(
            (item, index) => (
              <p className="mt-1" key={index}>
                {item}
              </p>
            ),
          )}
          {strings(draft.proposal.assumptions).length > 0 && (
            <>
              <p className="mt-2 font-medium">暂定假设，尚未由你确认</p>
              {strings(draft.proposal.assumptions).map((item, index) => (
                <p className="mt-1" key={index}>
                  {item}
                </p>
              ))}
            </>
          )}
          {strings(draft.open_questions).length > 3 && (
            <p className="mt-2">
              其他待确认：{strings(draft.open_questions).slice(3).join("；")}
            </p>
          )}
        </details>
        {Array.isArray(draft.revisions) && draft.revisions.length > 0 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer">
              修订记录 · {draft.revisions.length} 版
            </summary>
            {draft.revisions.map((version, index) => (
              <p className="mt-2" key={version.id ?? index}>
                第 {version.revision ?? index + 1} 版：
                {typeof version.proposal?.scope === "string"
                  ? version.proposal.scope
                  : "已保留"}
              </p>
            ))}
          </details>
        )}
        <Textarea
          className="mt-3 min-h-16"
          aria-label="补充或调整需求"
          placeholder="例如：先服务内部团队，这一期只验证原型……"
          value={feedback}
          disabled={submittedId === id}
          onChange={(event) => setFeedback(event.target.value)}
        />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={submittedId === id || !feedback.trim()}
            onClick={() => send(`/project refine ${id} ${feedback.trim()}`)}
          >
            更新草案
          </Button>
          {canReview && (
            <Button
              size="sm"
              variant="outline"
              disabled={submittedId === id || !!feedback.trim()}
              onClick={() => send(`/project review ${id}`)}
            >
              {status === "needs_review" ? "提交立项审批" : "重新提交审批"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
