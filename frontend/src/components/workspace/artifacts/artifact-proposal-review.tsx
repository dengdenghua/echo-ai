import { ClipboardCheckIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  decideArtifactProposal,
  listArtifactProposals,
  readArtifactProposal,
  type ArtifactProposal,
  type ArtifactProposalContent,
} from "@/core/artifacts/proposals";

const DiffViewer = lazy(() =>
  import("@/components/workspace/diff-viewer").then((module) => ({
    default: module.DiffViewer,
  })),
);
const labels = {
  pending: "待审",
  accepted: "已接受",
  rejected: "已拒绝",
  interrupted: "需检查",
};

export function ArtifactProposalReview({
  filepath,
  threadId,
  running,
  refreshKey,
  disabled,
  onApplied,
  onBusyChange,
  onReload,
}: {
  filepath: string;
  threadId: string;
  running: boolean;
  refreshKey: number;
  disabled?: boolean;
  onApplied: (content: string) => void;
  onBusyChange: (busy: boolean) => void;
  onReload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ArtifactProposal[]>([]);
  const [selected, setSelected] = useState("");
  const [proposal, setProposal] = useState<ArtifactProposalContent | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void listArtifactProposals({
      filepath,
      threadId,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setItems(result.proposals);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setItems([]);
          setError("修改记录读取失败，请重试。");
        }
      });
    return () => controller.abort();
  }, [filepath, threadId, running, refreshKey, refresh, open]);
  useEffect(() => {
    setProposal(null);
    setReading(false);
    if (!open || !selected) return;
    const controller = new AbortController();
    setReading(true);
    void readArtifactProposal({
      filepath,
      threadId,
      proposalId: selected,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setProposal(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("修改内容读取失败，请重新比较。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setReading(false);
      });
    return () => controller.abort();
  }, [filepath, threadId, open, selected, running, refresh]);

  async function decide(action: "accept" | "reject") {
    if (!proposal || saveRef.current || disabled) return;
    saveRef.current = true;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      const result = await decideArtifactProposal({
        filepath,
        threadId,
        proposalId: proposal.proposal_id,
        action,
        reviewedSha256: proposal.candidate_sha256,
      });
      if (result.status !== (action === "accept" ? "accepted" : "rejected"))
        throw new Error("操作结果尚未确认，请重新比较。");
      if (
        action === "accept" &&
        result.current_sha256 === proposal.candidate_sha256
      )
        onApplied(proposal.candidate_content);
      onReload?.();
      setItems((previous) =>
        previous.map((item) =>
          item.proposal_id === result.proposal_id ? result : item,
        ),
      );
      setProposal((previous) =>
        previous ? { ...previous, ...result } : previous,
      );
      setOpen(false);
    } catch (failure) {
      onReload?.();
      setError(
        failure instanceof Error
          ? failure.message
          : "操作未完成，请重新比较后重试。",
      );
      setProposal(null); // A stale comparison must not remain actionable.
    } finally {
      saveRef.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  const pending = items.filter(
    (item) => item.status === "pending" || item.status === "interrupted",
  ).length;
  if (!items.length && !error && !open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saveRef.current) {
          setOpen(next);
          setSelected("");
          setProposal(null);
        }
      }}
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="pointer-events-auto h-7 gap-1.5 px-2 text-xs shadow-md"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ClipboardCheckIcon className="size-3" />
        {pending ? `待审修改 ${pending}` : "修改记录"}
      </Button>
      {open && (
        <DialogContent
          className="flex h-[min(720px,calc(100dvh-2rem))] flex-col sm:max-w-5xl"
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>待审修改</DialogTitle>
            <DialogDescription>
              AI 在工作副本中修改。接受后才替换正式文件；拒绝会保留正式文件。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {running && (
            <p role="status" className="text-sm text-muted-foreground">
              任务仍在执行，完成后可接受修改。
            </p>
          )}
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-3 sm:grid-cols-[180px_1fr] sm:grid-rows-1">
            <div
              className="max-h-32 overflow-auto sm:max-h-none"
              aria-label="修改提案"
            >
              {items.map((item) => (
                <button
                  type="button"
                  key={item.proposal_id}
                  disabled={saving}
                  aria-pressed={selected === item.proposal_id}
                  className={`mb-1 w-full rounded-md border p-2 text-left text-xs ${selected === item.proposal_id ? "border-primary bg-accent" : "border-transparent hover:bg-accent"}`}
                  onClick={() => {
                    setSelected(item.proposal_id);
                    setError(null);
                  }}
                >
                  <span className="block">{labels[item.status]}</span>
                  {new Date(item.created_at * 1000).toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 min-w-0 flex-col rounded-lg border">
              <p className="border-b p-2 text-xs text-muted-foreground">
                删除部分为修改前内容，新增部分为 AI 工作副本
              </p>
              {reading ? (
                <p role="status" className="p-4 text-sm">
                  正在读取…
                </p>
              ) : proposal ? (
                <Suspense fallback={<p className="p-4">正在比较…</p>}>
                  <DiffViewer
                    className="min-h-0 flex-1"
                    oldValue={proposal.base_content}
                    newValue={proposal.candidate_content}
                    readOnly
                  />
                </Suspense>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  选择修改查看差异
                </p>
              )}
            </div>
          </div>
          {proposal?.status === "pending" && !proposal.changed && (
            <p className="text-sm text-muted-foreground">
              工作副本尚未产生修改，可等待任务完成后重新比较。
            </p>
          )}
          {proposal?.status === "pending" && proposal.conflict && (
            <p role="alert" className="text-sm text-destructive">
              正式文件已变化，请拒绝此提案并基于新版重新生成修改。
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setRefresh((value) => value + 1)}
            >
              重新比较
            </Button>
            <Button
              variant="outline"
              disabled={
                saving ||
                disabled ||
                !proposal ||
                !["pending", "interrupted"].includes(proposal.status)
              }
              onClick={() => void decide("reject")}
            >
              拒绝修改
            </Button>
            <Button
              disabled={
                saving ||
                disabled ||
                running ||
                reading ||
                !proposal ||
                proposal.status !== "pending" ||
                !proposal.changed ||
                proposal.conflict
              }
              onClick={() => void decide("accept")}
            >
              接受修改
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
