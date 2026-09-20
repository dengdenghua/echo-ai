import { useState } from "react";
import {
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  SearchIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/core/clipboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ProjectDecisionItem {
  id?: string;
  title?: string;
  summary?: string;
  decision?: string;
  actor?: string;
  milestone_id?: string;
  created_at?: string;
}

export function ProjectDecisionsModal({
  isOpen,
  onClose,
  projectName,
  decisions = [],
  onOpenWorkbench,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  decisions?: ProjectDecisionItem[];
  onOpenWorkbench?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredDecisions = decisions.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (d.title && d.title.toLowerCase().includes(q)) ||
      (d.summary && d.summary.toLowerCase().includes(q)) ||
      (d.decision && d.decision.toLowerCase().includes(q)) ||
      (d.actor && d.actor.toLowerCase().includes(q))
    );
  });

  const handleCopySingle = async (decision: ProjectDecisionItem, index: number) => {
    const text = decision.decision || decision.summary || decision.title || "";
    await copyTextToClipboard(text);
    const key = decision.id || `dec-${index}`;
    setCopiedId(key);
    toast.success("已复制该项决策内容");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAll = async () => {
    if (decisions.length === 0) return;
    const allText = decisions
      .map((d, i) => {
        const title = d.title || `决策 ${i + 1}`;
        const content = d.decision || d.summary || "";
        const actor = d.actor ? `（决策人/协作者：${d.actor}）` : "";
        return `### ${i + 1}. ${title} ${actor}\n${content}`;
      })
      .join("\n\n");

    const header = `# 【${projectName}】核心决策事实库\n共 ${decisions.length} 项既定决议\n\n`;
    await copyTextToClipboard(header + allText);
    toast.success("已复制全量决策事实库");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-3 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold">
            <BookmarkIcon className="size-4" />
            <DialogTitle className="text-base font-semibold text-foreground">
              {projectName} · 核心事实库与历史决议
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            长项目多人多 Agent 协同固化的核心技术决策与既定事实（共 {decisions.length} 项），为全员统一认知基准。
          </DialogDescription>

          {decisions.length > 0 && (
            <div className="mt-2 flex items-center justify-between rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-1.5 min-w-0">
                <ZapIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="truncate">
                  <strong>自进化规则联动：</strong>
                  已将 {decisions.length} 条项目决议编译为动态约束，全员协作者自动遵守
                </span>
              </div>
              <a
                href="#/workspace/evolution"
                className="inline-flex items-center gap-1 font-medium hover:underline shrink-0 text-amber-900 dark:text-amber-200 ml-2"
              >
                <span>自进化面板</span>
                <ExternalLinkIcon className="size-3" />
              </a>
            </div>
          )}

          <div className="relative mt-2">
            <SearchIcon className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="按决议标题、内容或协作者搜索…"
              className="h-8 pl-8 text-xs bg-background"
            />
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px]">
          {filteredDecisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <SparklesIcon className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs">
                {decisions.length === 0
                  ? "暂无已沉淀的决策，可在并列协作者交付成果时点击「固化为决策」进行记录"
                  : "未找到匹配的决策记录"}
              </p>
            </div>
          ) : (
            filteredDecisions.map((item, index) => {
              const key = item.id || `dec-${index}`;
              const isCopied = copiedId === key;
              const content = item.decision || item.summary || "";
              return (
                <div
                  key={key}
                  data-testid={`decision-item-${index}`}
                  className="rounded-lg border border-border/60 bg-background p-3 text-xs space-y-1.5 shadow-2xs hover:border-amber-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        #{index + 1}
                      </span>
                      <span className="font-semibold">{item.title || "技术决策"}</span>
                      <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        <ZapIcon className="size-2.5" />
                        已纳管为规则
                      </span>
                      {item.actor && (
                        <span className="text-[10px] text-muted-foreground">
                          · {item.actor}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopySingle(item, index)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      title="复制单条决议"
                    >
                      {isCopied ? (
                        <CheckIcon className="size-3 text-emerald-500" />
                      ) : (
                        <CopyIcon className="size-3" />
                      )}
                      <span>{isCopied ? "已复制" : "复制"}</span>
                    </button>
                  </div>

                  {content && (
                    <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed pl-2 border-l-2 border-amber-500/30">
                      {content}
                    </div>
                  )}

                  {item.created_at && (
                    <div className="text-[10px] text-muted-foreground/60 text-right">
                      固化时间：{item.created_at}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-3 border-t border-border/50 bg-muted/10 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            disabled={decisions.length === 0}
            className="h-7 text-xs gap-1.5"
          >
            <CopyIcon className="size-3" />
            <span>复制全部决策</span>
          </Button>

          <div className="flex items-center gap-2">
            {onOpenWorkbench && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenWorkbench();
                }}
                className="h-7 text-xs gap-1"
              >
                <span>在工作台中查看</span>
                <ExternalLinkIcon className="size-3" />
              </Button>
            )}
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onClose}
              className="h-7 text-xs px-3"
            >
              完成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
