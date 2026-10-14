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
import { useI18n } from "@/core/i18n/hooks";
import { projectCollabCopy } from "@/core/i18n/locales/project-collab";

/*
 * Message markers written into conversation history by
 * inline-subagent-card-expansion.tsx and realtime/sandbox-merge-banner.tsx.
 * They are a stored data protocol, not UI copy: never translate or reword
 * them, or existing conversations stop rendering as landmark cards. Only the
 * text a card displays is localized (core/i18n/locales/project-collab.ts).
 */
export const DECISION_MARKER = "🏛️ [项目决策固化]";
export const SANDBOX_MARKER = "【方案推演沙盒】";
export const MERGE_MARKER = "🏛️ [推演结论合并]";
/** `📢 来自并列协作者【{name}】的阶段交付：` heads a delivered result. */
export const BROADCAST_DELIVERY_PREFIX = "📢 来自并列协作者【";
export const BROADCAST_DELIVERY_SUFFIX = "】的阶段交付：";
/** `📢 并列协作者【{name}】正在推进：` heads work that has no result yet. */
export const BROADCAST_PROGRESS_PREFIX = "📢 并列协作者【";
export const BROADCAST_PROGRESS_SUFFIX = "】正在推进：";

const DECISION_RE = /^🏛️\s*\[项目决策固化\]\s*/;
const SANDBOX_RE = /^🌱\s*【方案推演沙盒】\s*/;
const BROADCAST_RE = /^📢\s*(?:来自)?并列协作者【/;
const BROADCAST_HEADER_RE =
  /^📢\s*(?:来自)?并列协作者【([^】\n]*)】(的阶段交付|正在推进)?[：:]?\s*/;
const MERGE_RE = /^🏛️\s*\[推演结论合并\]\s*/;

export type LandmarkKind = "decision" | "sandbox" | "broadcast" | "merge";

export interface LandmarkMatch {
  kind: LandmarkKind;
  body: string;
  /** Broadcast only: the sender and phase parsed from the protocol header. */
  broadcast?: { agentName: string; phase: "delivery" | "progress" };
}

export function parseCollaborationLandmark(content: string): LandmarkMatch | null {
  const trimmed = content.trim();

  // 1. 项目决策固化
  if (DECISION_RE.test(trimmed)) {
    return { kind: "decision", body: trimmed.replace(DECISION_RE, "") };
  }

  // 2. 方案推演沙盒
  if (SANDBOX_RE.test(trimmed)) {
    return { kind: "sandbox", body: trimmed.replace(SANDBOX_RE, "") };
  }

  // 3. 协作者阶段交付广播
  if (BROADCAST_RE.test(trimmed)) {
    const header = BROADCAST_HEADER_RE.exec(trimmed);
    if (!header) {
      return { kind: "broadcast", body: trimmed.replace(/^📢\s*/, "") };
    }
    return {
      kind: "broadcast",
      body: trimmed.slice(header[0].length),
      broadcast: {
        agentName: header[1] ?? "",
        phase: header[2] === "正在推进" ? "progress" : "delivery",
      },
    };
  }

  // 4. 沙盒推演结论合入主干
  if (MERGE_RE.test(trimmed)) {
    return { kind: "merge", body: trimmed.replace(MERGE_RE, "") };
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
  const { locale, t } = useI18n();
  const copy = projectCollabCopy(locale).landmark;
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyTextToClipboard(rawContent);
    setCopied(true);
    toast.success(t.clipboard.copiedToClipboard);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleEnterSandbox = () => {
    const params = new URLSearchParams();
    params.set("sandbox", "true");
    params.set("prompt", match.body);
    void navigate(`/workspace/realtime/new?${params.toString()}`);
    toast.info(copy.enteringSandbox);
  };

  if (match.kind === "decision") {
    return (
      <div
        data-testid="landmark-decision-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-primary">
            <BookmarkIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{copy.decisionTitle}</span>
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.2 text-micro font-medium text-primary">
              ⚡ {copy.decisionTag}
            </span>
          </div>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {copy.decisionBadge}
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
            <span>{copied ? t.common.copied : copy.copyDecision}</span>
          </button>
        </div>
      </div>
    );
  }

  if (match.kind === "sandbox") {
    return (
      <div
        data-testid="landmark-sandbox-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-primary">
            <GitBranchIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{copy.sandboxTitle}</span>
          </div>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {copy.sandboxBadge}
          </span>
        </div>

        <div className="mt-2 text-xs leading-relaxed text-foreground/90">
          {renderBody(match.body)}
        </div>

        <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-primary/20 pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            <span>{copied ? t.common.copied : copy.copySandbox}</span>
          </button>
          <button
            type="button"
            onClick={handleEnterSandbox}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ExternalLinkIcon className="size-3" />
            <span>{copy.enterSandbox}</span>
          </button>
        </div>
      </div>
    );
  }

  if (match.kind === "merge") {
    return (
      <div
        data-testid="landmark-merge-card"
        className="my-2 w-full max-w-2xl rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background p-3.5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 pb-2">
          <div className="flex items-center gap-1.5 font-semibold text-primary">
            <GitMergeIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs">{copy.mergeTitle}</span>
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.2 text-micro font-medium text-primary">
              🧬 {copy.mergeTag}
            </span>
          </div>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {copy.mergeBadge}
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
            <span>{copied ? t.common.copied : copy.copyMerge}</span>
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
          <span className="text-xs">{copy.broadcastTitle}</span>
        </div>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
          {copy.broadcastBadge}
        </span>
      </div>

      {match.broadcast && (
        <p className="mt-2 text-xs font-medium text-foreground">
          {match.broadcast.phase === "progress"
            ? copy.broadcastProgress(match.broadcast.agentName)
            : copy.broadcastDelivery(match.broadcast.agentName)}
        </p>
      )}

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
          <span>{copied ? t.common.copied : copy.copyBroadcast}</span>
        </button>
      </div>
    </div>
  );
}
