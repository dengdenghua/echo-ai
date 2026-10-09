import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  Share2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/core/clipboard";

export type LandmarkKind = "decision" | "sandbox" | "broadcast" | "merge";

export interface LandmarkMatch {
  kind: LandmarkKind;
  title: string;
  badge: string;
  body: string;
}

export function parseCollaborationLandmark(content: string): LandmarkMatch | null {
  const trimmed = content.trim();

  // 1. 项目决策固化
  if (/^🏛️\s*\[项目决策固化\]/.test(trimmed)) {
    const afterHeader = trimmed.replace(/^🏛️\s*\[项目决策固化\]\s*/, "");
    return {
      kind: "decision",
      title: "项目核心决策固化",
      badge: "已沉淀至事实库",
      body: afterHeader,
    };
  }

  // 2. 方案推演沙盒
  if (/^🌱\s*【方案推演沙盒】/.test(trimmed)) {
    const afterHeader = trimmed.replace(/^🌱\s*【方案推演沙盒】\s*/, "");
    return {
      kind: "sandbox",
      title: "方案推演沙盒",
      badge: "POC 隔离验证",
      body: afterHeader,
    };
  }

  // 3. 协作者阶段交付广播
  if (/^📢\s*(?:来自)?并列协作者【/.test(trimmed)) {
    const afterHeader = trimmed.replace(/^📢\s*/, "");
    return {
      kind: "broadcast",
      title: "协作者阶段成果广播",
      badge: "已同步至群公共",
      body: afterHeader,
    };
  }

  // 4. 沙盒推演结论合入主干
  if (/^🏛️\s*\[推演结论合并\]/.test(trimmed)) {
    const afterHeader = trimmed.replace(/^🏛️\s*\[推演结论合并\]\s*/, "");
    return {
      kind: "merge",
      title: "沙盒推演结论合入主干",
      badge: "已合入主项目",
      body: afterHeader,
    };
  }

  return null;
}

export function ProjectCollaborationLandmark({
  match,
  rawContent,
  renderBody,
}: {
  match: LandmarkMatch;
  rawContent: string;
  renderBody: (body: string) => ReactNode;
}) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyTextToClipboard(rawContent);
    setCopied(true);
    toast.success("已复制内容至剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnterSandbox = () => {
    const params = new URLSearchParams();
    params.set("sandbox", "true");
    params.set("prompt", match.body);
    void navigate(`/workspace/realtime/new?${params.toString()}`);
    toast.info("正在进入方案推演沙盒分支");
  };

  if (match.kind === "decision") {
    return (
      <div
        data-testid="landmark-decision-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
            <BookmarkIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{match.title}</span>
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] font-medium text-amber-800 dark:text-amber-300">
              ⚡ 规则已纳管
            </span>
          </div>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">
            {match.badge}
          </span>
        </div>

        <div className="mt-2 text-xs leading-relaxed text-foreground/90">
          {renderBody(match.body)}
        </div>

        <div className="mt-2.5 flex items-center justify-end border-t border-amber-500/20 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 dark:text-amber-300"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            <span>{copied ? "已复制" : "复制决策内容"}</span>
          </button>
        </div>
      </div>
    );
  }

  if (match.kind === "sandbox") {
    return (
      <div
        data-testid="landmark-sandbox-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-emerald-500/35 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
            <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{match.title}</span>
          </div>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">
            {match.badge}
          </span>
        </div>

        <div className="mt-2 text-xs leading-relaxed text-foreground/90">
          {renderBody(match.body)}
        </div>

        <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-emerald-500/20 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            <span>{copied ? "已复制" : "复制推演内容"}</span>
          </button>
          <button
            type="button"
            onClick={handleEnterSandbox}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
          >
            <ExternalLinkIcon className="size-3" />
            <span>进入推演沙盒</span>
          </button>
        </div>
      </div>
    );
  }

  if (match.kind === "merge") {
    return (
      <div
        data-testid="landmark-merge-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-indigo-500/35 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-400">
            <GitMergeIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{match.title}</span>
            <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/15 px-1 py-0.2 text-[9px] font-medium text-indigo-800 dark:text-indigo-300">
              🧬 进化证据已归档
            </span>
          </div>
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-800 dark:text-indigo-300">
            {match.badge}
          </span>
        </div>

        <div className="mt-2 text-xs leading-relaxed text-foreground/90">
          {renderBody(match.body)}
        </div>

        <div className="mt-2.5 flex items-center justify-end border-t border-indigo-500/20 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-700 transition-colors hover:bg-indigo-500/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 dark:text-indigo-300"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            <span>{copied ? "已复制" : "复制推演结论"}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="landmark-broadcast-card"
      className="my-2 w-full max-w-2xl rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3.5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-primary">
          <Share2Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-xs">{match.title}</span>
        </div>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
          {match.badge}
        </span>
      </div>

      <div className="mt-2 text-xs leading-relaxed text-foreground/90">
        {renderBody(match.body)}
      </div>

      <div className="mt-2.5 flex items-center justify-end border-t border-primary/20 pt-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          <span>{copied ? "已复制" : "复制成果"}</span>
        </button>
      </div>
    </div>
  );
}
