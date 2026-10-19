// Confirmation dialogs for the narrative studio (canon commit + governance).

import { LoaderCircleIcon, ShieldCheckIcon, VoteIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { NarrativeReviewRequest } from "./api";

export function CanonCommitDialog({
  review,
  busy,
  onClose,
  onConfirm,
}: {
  review: NarrativeReviewRequest;
  busy: boolean;
  onClose: () => void;
  onConfirm: (actor: string, rationale: string) => void;
}) {
  const [actor, setActor] = useState("human-editor");
  const [rationale, setRationale] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="canon-confirm-title"
        className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="canon-confirm-title" className="font-semibold">
              二次确认：提交正典
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              这会创建不可伪造的正典提交记录。内容不会因为打开此窗口而改变。
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭正典确认"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs">
          <p className="font-medium">{review.title}</p>
          <p className="mt-1 text-muted-foreground">
            审核 {review.id} · 修订 {review.revision}
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5 text-sm">
            操作者
            <Input
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="人工编辑标识"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            提交理由
            <Textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="说明为什么该修订可以进入正典"
              className="min-h-24"
            />
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              我已核对审核票数、阻塞项和目标修订，并确认由人工执行本次正典提交。
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={() => onConfirm(actor.trim(), rationale.trim())}
            disabled={!confirmed || !actor.trim() || !rationale.trim() || busy}
          >
            {busy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <ShieldCheckIcon className="size-4" />
            )}
            确认提交正典
          </Button>
        </div>
      </div>
    </div>
  );
}

export function GovernanceActionDialog({
  title,
  description,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="governance-confirm-title"
        className="w-full max-w-md rounded-2xl border border-border/70 bg-background p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
            <VoteIcon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="governance-confirm-title" className="font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭治理确认"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 bg-muted/40 p-3 text-xs leading-5">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            我确认这会写入真实治理记录，但不会绕过
            quorum、阻塞项或人工正典提交。
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={!confirmed || busy}>
            {busy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <VoteIcon className="size-4" />
            )}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
