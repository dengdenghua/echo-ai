import { useState } from "react";
import { useThreadListVisibility, useThreads } from "@/core/threads/hooks";
import { deriveThreadTitle } from "@/core/threads/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function RemovedThreads() {
  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useThreads({
    hidden_only: true,
    limit: 200,
    select: ["thread_id", "values.title", "values.sidebar_title_source", "metadata", "updated_at"],
  });
  const restore = useThreadListVisibility();
  if (isLoading) return <p>正在加载…</p>;
  if (isError)
    return <Button onClick={() => void refetch()}>加载失败，重试</Button>;
  if (!data.length)
    return <p className="text-sm text-muted-foreground">没有已移除的对话</p>;
  return (
    <ul className="max-h-[50vh] overflow-y-auto">
      {data.map((thread) => (
        <li key={thread.thread_id} className="flex items-center gap-3 py-2">
          <span className="min-w-0 flex-1 truncate">
            {deriveThreadTitle(thread)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={restore.isPending}
            onClick={() =>
              restore.mutate({ threadId: thread.thread_id, hidden: false })
            }
          >
            恢复到列表
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function RemovedThreadsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        已移除
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>已从我的列表移除</DialogTitle>
            <DialogDescription>
              群聊、项目和文件仍然保留。恢复只影响你自己的对话列表。
            </DialogDescription>
          </DialogHeader>
          {open && <RemovedThreads />}
        </DialogContent>
      </Dialog>
    </>
  );
}
