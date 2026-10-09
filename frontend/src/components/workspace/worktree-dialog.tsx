import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranchIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  executionStorageKey,
  getRemoteExecutionId,
} from "@/core/execution-location";
import { useI18n } from "@/core/i18n/hooks";
import {
  createGitWorktree,
  listGitWorktrees,
} from "@/core/workspace/worktrees";

export function WorktreeDialog({
  open,
  onOpenChange,
  projectPath,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  onOpenTask: (path: string) => void;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const queryClient = useQueryClient();
  const scope = executionStorageKey("git-worktrees");
  const key = [scope, projectPath];
  const openRef = useRef(open);
  openRef.current = open;
  const pathRef = useRef(projectPath);
  pathRef.current = projectPath;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [revision, setRevision] = useState("HEAD");
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listGitWorktrees(projectPath, signal),
    enabled: open && Boolean(projectPath),
    staleTime: 0,
    retry: false,
  });
  const create = useMutation({
    mutationFn: ({ path, revision }: { path: string; revision: string }) =>
      createGitWorktree(path, revision),
    onSuccess: (worktree, variables) => {
      void queryClient.invalidateQueries({ queryKey: [scope, variables.path] });
      if (
        !mountedRef.current ||
        !openRef.current ||
        pathRef.current !== variables.path
      )
        return;
      onOpenTask(worktree.path);
      onOpenChange(false);
    },
  });
  useEffect(() => {
    setRevision("HEAD");
  }, [projectPath, open]);
  const error = create.error ?? list.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {zh ? "隔离任务 · Worktrees" : "Isolated tasks · Worktrees"}
          </DialogTitle>
          <DialogDescription>
            {zh
              ? "在独立目录中开展任务，保留当前工作区。新目录仅包含所选分支已提交的代码。"
              : "Work in a separate directory while keeping your current workspace. New worktrees contain committed files from the chosen branch."}
          </DialogDescription>
        </DialogHeader>
        <p className="break-all rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          {getRemoteExecutionId()
            ? zh
              ? "所选远程电脑"
              : "Selected remote computer"
            : zh
              ? "当前 Echo 服务"
              : "Current Echo service"}
          <span className="mt-1 block font-mono">
            {projectPath ||
              (zh ? "请先选择 Git 项目" : "Choose a Git project first")}
          </span>
        </p>
        {error && (
          <div
            role="alert"
            className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            <p>{error instanceof Error ? error.message : String(error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                create.reset();
                void list.refetch();
              }}
            >
              <RefreshCwIcon className="size-3.5" />
              {zh ? "重新检查" : "Retry"}
            </Button>
          </div>
        )}
        {list.isPending && projectPath && (
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2Icon className="size-4 animate-spin" />
            {zh ? "检查 Git 项目…" : "Checking Git project…"}
          </div>
        )}
        {list.data && !list.isError && (
          <>
            <form
              className="space-y-3 rounded-lg border p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!create.isPending)
                  create.mutate({ path: projectPath, revision });
              }}
            >
              <label
                className="block text-sm font-medium"
                htmlFor="worktree-revision"
              >
                {zh ? "起始分支" : "Starting branch"}
              </label>
              <select
                id="worktree-revision"
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
                disabled={create.isPending}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="HEAD">
                  {zh ? "当前提交（HEAD）" : "Current commit (HEAD)"}
                </option>
                {list.data.branches
                  .filter((branch) => branch !== "HEAD")
                  .map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
              </select>
              <Button
                type="submit"
                disabled={create.isPending || list.isFetching}
                className="w-full"
              >
                {create.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <GitBranchIcon className="size-4" />
                )}
                {zh ? "创建并打开新任务" : "Create and open task"}
              </Button>
            </form>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {zh ? "已有工作区" : "Existing workspaces"}
              </p>
              {list.data.worktrees.map((item) => (
                <div
                  key={item.path}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.branch || item.commit.slice(0, 8)}
                      {item.current ? (zh ? " · 当前" : " · Current") : ""}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {item.path}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={create.isPending}
                    onClick={() => {
                      onOpenTask(item.path);
                      onOpenChange(false);
                    }}
                  >
                    {zh ? "新任务" : "New task"}
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
