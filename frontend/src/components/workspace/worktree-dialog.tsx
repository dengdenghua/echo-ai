import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { worktreeCopy } from "@/core/i18n/locales/worktrees";
import { useOptionalAuth } from "@/providers/AuthProvider";
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
  const copy = worktreeCopy(locale);
  const auth = useOptionalAuth();
  const baseUrl = getBackendBaseURL();
  const account = auth?.user?.actor_id || auth?.user?.user_id || "local";
  const scope = JSON.stringify([baseUrl, auth?.user?.provider ?? "", account]);
  const available =
    !auth?.isLoading && (!auth?.authStatus?.enabled || !!auth?.isAuthenticated);
  const key = ["git-worktrees", scope, projectPath];
  const current = useRef({ open, projectPath, scope, mounted: true, epoch: 0 });
  const previous = current.current;
  current.current = {
    open,
    projectPath,
    scope,
    mounted: previous.mounted,
    epoch:
      previous.epoch +
      (previous.open !== open ||
      previous.projectPath !== projectPath ||
      previous.scope !== scope
        ? 1
        : 0),
  };
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState("HEAD");
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listGitWorktrees(projectPath, baseUrl, signal),
    enabled: open && available && !!projectPath,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const create = useMutation({
    mutationFn: (variables: {
      path: string;
      revision: string;
      baseUrl: string;
      scope: string;
      epoch: number;
    }) =>
      createGitWorktree(variables.path, variables.revision, variables.baseUrl),
    retry: false,
    onSuccess: (worktree, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["git-worktrees", variables.scope, variables.path],
      });
      const state = current.current;
      if (
        !state.mounted ||
        !state.open ||
        state.scope !== variables.scope ||
        state.projectPath !== variables.path ||
        state.epoch !== variables.epoch
      )
        return;
      onOpenTask(worktree.path);
      onOpenChange(false);
    },
  });
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  useEffect(() => {
    setRevision("HEAD");
  }, [projectPath, scope, open]);
  useEffect(() => {
    if (!open)
      void queryClient.cancelQueries({
        queryKey: ["git-worktrees", scope, projectPath],
        exact: true,
      });
  }, [open, scope, projectPath, queryClient]);
  const error =
    (create.variables?.scope === scope && create.variables.path === projectPath
      ? create.error
      : null) || list.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <p className="break-all font-mono text-xs">{projectPath}</p>
        {error && (
          <div role="alert">
            <p>{copy.unavailable}</p>
            <Button
              variant="outline"
              onClick={() => {
                create.reset();
                void list.refetch();
              }}
            >
              {copy.retry}
            </Button>
          </div>
        )}
        {list.isPending && available && <p role="status">{copy.checking}</p>}
        {list.data && !list.isError && available && (
          <>
            <form
              className="space-y-3 rounded-lg border p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!create.isPending && !error)
                  create.mutate({
                    path: projectPath,
                    revision,
                    baseUrl,
                    scope,
                    epoch: current.current.epoch,
                  });
              }}
            >
              <label htmlFor="worktree-revision">{copy.branch}</label>
              <select
                id="worktree-revision"
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
                disabled={create.isPending}
                className="h-9 w-full rounded-md border bg-background px-2"
              >
                <option value="HEAD">{copy.head}</option>
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
                disabled={create.isPending || list.isFetching || !!error}
              >
                {copy.create}
              </Button>
            </form>
            <p className="text-sm">{copy.existing}</p>
            {list.data.worktrees.map((item) => (
              <div
                key={item.path}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p>
                    {item.branch || item.commit.slice(0, 8)}
                    {item.current ? ` · ${copy.current}` : ""}
                    {item.locked ? ` · ${copy.locked}` : ""}
                  </p>
                  <p className="break-all font-mono text-xs">{item.path}</p>
                </div>
                <Button
                  variant="outline"
                  disabled={create.isPending}
                  onClick={() => {
                    onOpenTask(item.path);
                    onOpenChange(false);
                  }}
                >
                  {copy.open}
                </Button>
              </div>
            ))}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
