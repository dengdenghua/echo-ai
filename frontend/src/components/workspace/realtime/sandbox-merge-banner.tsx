import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckIcon,
  DnaIcon,
  GitBranchIcon,
  GitMergeIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { eventBus } from "@/core/events/event-bus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface SandboxMergeBannerProps {
  parentThreadId?: string;
  agentName?: string;
  initialConclusion?: string;
  onMergeComplete?: () => void;
}

export function SandboxMergeBanner({
  parentThreadId,
  agentName = "并列协作者",
  initialConclusion = "",
  onMergeComplete,
}: SandboxMergeBannerProps) {
  const navigate = useNavigate();
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [conclusionText, setConclusionText] = useState(
    initialConclusion || `经独立推演与 POC 验证，该方案架构可行，已满足核心指标并可在长项目主干中采纳落地。`,
  );
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleConfirmMerge = () => {
    const text = conclusionText.trim();
    if (!text) {
      toast.error("请输入推演结论内容");
      return;
    }

    const mergePayload = `🏛️ [推演结论合并] 来自【${agentName}】沙盒推演成果：\n\n${text}`;

    if (parentThreadId) {
      // 导航回父项目群并载入合并结论
      navigate(`/workspace/realtime/${parentThreadId}`);
      setTimeout(() => {
        eventBus.emit("composer:insert-mention", {
          text: mergePayload,
          submit: true,
        });
      }, 300);
    } else {
      eventBus.emit("composer:insert-mention", {
        text: mergePayload,
        submit: true,
      });
    }

    setShowMergeDialog(false);
    toast.success("已将沙盒推演结论合并入项目主干");
    onMergeComplete?.();
  };

  return (
    <>
      <div
        data-testid="sandbox-merge-banner"
        className="flex items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-900 dark:text-emerald-200"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
            <GitBranchIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="font-semibold">方案推演沙盒模式</span>
              <span className="text-[10px] rounded bg-emerald-500/20 px-1 py-0.2 text-emerald-800 dark:text-emerald-300">
                协作者：{agentName}
              </span>
              <span className="text-[10px] rounded bg-primary/15 px-1 py-0.2 font-medium text-primary flex items-center gap-0.5">
                <DnaIcon className="size-2.5" />
                双螺旋复核中
              </span>
            </div>
            <p className="truncate text-[11px] text-emerald-700/85 dark:text-emerald-300/80">
              当前在隔离分支展开 POC 概念验证，过程产出不污染项目主干；合并时自动归档自进化记忆。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            onClick={() => setShowMergeDialog(true)}
            className="h-7 gap-1 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <GitMergeIcon className="size-3" />
            <span>合并结论至主项目</span>
          </Button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="收起推演沙盒横幅"
            className="rounded p-1 text-emerald-700/70 hover:bg-emerald-500/20 hover:text-emerald-900 dark:text-emerald-300/70 dark:hover:text-emerald-100"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
              <GitMergeIcon className="size-4" />
              <DialogTitle>合并推演结论至长项目主干</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              将【{agentName}】沙盒推演中验证成立的方案结论，以权威格式合入主项目时间线与事实库。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label className="text-xs font-medium text-foreground">
              推演结论总结：
            </label>
            <Textarea
              value={conclusionText}
              onChange={(e) => setConclusionText(e.target.value)}
              rows={4}
              placeholder="概括沙盒验证结论与采纳建议…"
              className="text-xs leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowMergeDialog(false)}
              className="h-8 text-xs"
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmMerge}
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckIcon className="size-3.5" />
              <span>确认合并回主项目</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
