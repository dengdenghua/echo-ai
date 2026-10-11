import { SendHorizontalIcon } from "lucide-react";
import type { Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";

const groupCopy: Record<Locale, { label: string; title: string }> = {
  "en-US": {
    label: "Queue message",
    title: "Send after the current group turn finishes",
  },
  "zh-CN": { label: "排队发送", title: "当前群回复结束后按顺序发送" },
  "ja-JP": {
    label: "送信待ちに追加",
    title: "現在のグループ応答が終わった後に順番に送信",
  },
  "ko-KR": {
    label: "메시지 대기열에 추가",
    title: "현재 그룹 응답이 끝나면 순서대로 전송",
  },
};

export function StreamingSendActions({
  group,
  blocked,
  busy,
  hasAttachments,
  blockedLabel,
  onSubmit,
  onQueueLater,
}: {
  group: boolean;
  blocked: boolean;
  busy: boolean;
  hasAttachments: boolean;
  blockedLabel: string;
  onSubmit: () => void;
  onQueueLater: () => void;
}) {
  const { locale } = useI18n();
  const copy = groupCopy[locale];
  return (
    <>
      {!group && (
        <button
          type="button"
          title="当前回复结束后执行；附件请在任务结束后发送"
          disabled={busy || blocked || hasAttachments}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          onClick={onQueueLater}
        >
          稍后执行
        </button>
      )}
      <button
        type="button"
        onClick={onSubmit}
        data-testid={group ? "chat-queue-button" : "chat-steer-button"}
        disabled={busy || blocked}
        className="flex size-[42px] items-center justify-center rounded-lg bg-foreground text-background transition-all duration-base hover:bg-foreground/90 active:scale-95 disabled:cursor-wait disabled:opacity-70 sm:size-8"
        title={
          blocked
            ? blockedLabel
            : group
              ? copy.title
              : "现在补充，不中断当前操作"
        }
        aria-label={group ? copy.label : "现在补充"}
      >
        <SendHorizontalIcon className="size-3.5" />
      </button>
    </>
  );
}
