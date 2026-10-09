import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAPIClient } from "@/core/api";
import { authHeaders } from "@/core/auth/api";
import { getControlPlaneBaseURL } from "@/core/config";
import { toHashRouterShellUrl } from "@/core/router/hash-shell-url";
import { taskWorkspaceRoute } from "@/core/router/task-workspace-route";
import { deriveThreadTitle } from "@/core/threads/sidebar";
import { isAbsolutePath, joinPath } from "@/lib/path-utils";

import {
  normalizeWorkDirKey,
  personalRoleFolderName,
  readRememberedChatWorkDir,
  rememberChatWorkDir,
} from "./page-utils";

interface ThreadQueryScope {
  threadId: string;
  isNewThread: boolean;
  /** Set while this page is streaming the first turn of a thread it started. */
  localStartedThreadIdRef: RefObject<string | null>;
}

/**
 * The project directory bound to this conversation. Empty means the thread
 * uses its isolated personal coding workspace; selecting a local folder binds
 * a user project directory without mixing it with the separate Team workspace.
 */
export function useThreadWorkspace({
  threadId,
  isNewThread,
  localStartedThreadIdRef,
}: ThreadQueryScope) {
  const [workDir, setWorkDir] = useState<string>(() =>
    isNewThread ? "" : readRememberedChatWorkDir(),
  );
  const handleWorkDirChange = useCallback((dir: string) => {
    setWorkDir(dir);
    rememberChatWorkDir(dir);
  }, []);
  const threadWorkspaceQuery = useQuery({
    queryKey: ["thread", "workspace-path", threadId],
    enabled:
      !isNewThread &&
      Boolean(threadId) &&
      localStartedThreadIdRef.current !== threadId,
    queryFn: async () => {
      // Realtime/SSE streams share localhost's HTTP/1.1 connection pool. A
      // separate loopback alias keeps this binding lookup from sitting behind
      // those streams and flashing "个人空间" for several seconds.
      const response = await fetch(
        `${getControlPlaneBaseURL()}/api/threads/${encodeURIComponent(threadId)}/state`,
        { headers: authHeaders() },
      );
      if (!response.ok) {
        throw new Error(`Thread workspace unavailable (${response.status})`);
      }
      const state = (await response.json()) as {
        metadata?: Record<string, unknown>;
      };
      const workspacePath = state.metadata?.["workspace_path"];
      return typeof workspacePath === "string" && isAbsolutePath(workspacePath)
        ? workspacePath
        : "";
    },
    refetchOnWindowFocus: false,
  });
  return { workDir, setWorkDir, handleWorkDirChange, threadWorkspaceQuery };
}

/** Keeps the bound directory in step with the persisted thread metadata. */
export function usePersistedWorkspaceSync({
  threadId,
  isNewThread,
  localStartedThreadIdRef,
  threadWorkspaceQuery,
  setWorkDir,
}: ThreadQueryScope & {
  threadWorkspaceQuery: ReturnType<typeof useThreadWorkspace>["threadWorkspaceQuery"];
  setWorkDir: ReturnType<typeof useThreadWorkspace>["setWorkDir"];
}) {
  const persistedThreadWorkspacePath = threadWorkspaceQuery.data ?? "";

  useEffect(() => {
    if (
      isNewThread ||
      threadWorkspaceQuery.isPending ||
      localStartedThreadIdRef.current === threadId
    ) {
      return;
    }
    if (!persistedThreadWorkspacePath) {
      // A transient query failure (the thread is not persisted yet — e.g.
      // the throwaway uuid /new still holds while the first turn is
      // streaming) must NOT be read as "no bound workspace". Treating that
      // 404 as empty wiped the user's bound folder and remembered workdir
      // mid-conversation, which is the "bound but still lost" bug.
      if (threadWorkspaceQuery.isSuccess) {
        setWorkDir("");
        rememberChatWorkDir("");
      }
      return;
    }
    setWorkDir((current) => {
      if (
        normalizeWorkDirKey(current) ===
        normalizeWorkDirKey(persistedThreadWorkspacePath)
      ) {
        return current;
      }
      rememberChatWorkDir(persistedThreadWorkspacePath);
      return persistedThreadWorkspacePath;
    });
  }, [
    isNewThread,
    localStartedThreadIdRef,
    persistedThreadWorkspacePath,
    setWorkDir,
    threadId,
    threadWorkspaceQuery.isPending,
    threadWorkspaceQuery.isSuccess,
    threadWorkspaceQuery.isError,
  ]);
}

/** The persisted thread record (owner, roster, project-home flags, title). */
export function useThreadIdentity({
  threadId,
  isNewThread,
  localStartedThreadIdRef,
}: ThreadQueryScope) {
  const threadIdentityQuery = useQuery({
    queryKey: ["thread", "identity", threadId],
    enabled:
      !isNewThread &&
      Boolean(threadId) &&
      localStartedThreadIdRef.current !== threadId,
    queryFn: async () => getAPIClient().threads.get(threadId),
    refetchOnWindowFocus: false,
    retry: false,
  });
  // The live stream state has no ``title`` (the realtime adapter maps only the
  // turn stream), so resolve the header/browser-tab title from the persisted
  // thread record — same derivation the sidebar uses.
  const headerThreadTitle = useMemo(
    () =>
      threadIdentityQuery.data
        ? deriveThreadTitle(threadIdentityQuery.data)
        : undefined,
    [threadIdentityQuery.data],
  );
  return { threadIdentityQuery, headerThreadTitle };
}

interface WorkspaceScopeInput extends ThreadQueryScope {
  isPending: boolean;
  hintedWorkspacePath: string;
  workDir: string;
  personalSpaceRoot: string;
  embeddedDesignChat: boolean;
  embeddedCreationSpace: string;
  perspectiveDisplayAgent: Parameters<typeof personalRoleFolderName>[0];
  mainPerspectiveAgentId: string;
}

/**
 * Resolves the directory a turn runs in: the bound project folder, or the
 * current role's readable child folder inside the user's personal space.
 */
export function resolveWorkspaceScope({
  threadId,
  isNewThread,
  localStartedThreadIdRef,
  isPending,
  hintedWorkspacePath,
  workDir,
  personalSpaceRoot,
  embeddedDesignChat,
  embeddedCreationSpace,
  perspectiveDisplayAgent,
  mainPerspectiveAgentId,
}: WorkspaceScopeInput) {
  const effectiveWorkDir =
    !isNewThread &&
    isPending &&
    localStartedThreadIdRef.current !== threadId &&
    hintedWorkspacePath
      ? hintedWorkspacePath
      : workDir;
  const projectWorkspacePath = effectiveWorkDir.trim();
  const personalWorkspaceRoot = !projectWorkspacePath
    ? personalSpaceRoot.trim()
    : "";
  const personalWorkspacePath = personalWorkspaceRoot
    ? embeddedDesignChat && embeddedCreationSpace
      ? joinPath(
          joinPath(personalWorkspaceRoot, "创作空间"),
          personalRoleFolderName(
            perspectiveDisplayAgent,
            embeddedCreationSpace,
          ),
        )
      : joinPath(
          personalWorkspaceRoot,
          personalRoleFolderName(
            perspectiveDisplayAgent,
            mainPerspectiveAgentId,
          ),
        )
    : "";
  const isProjectCodeMode = !!projectWorkspacePath;
  return {
    effectiveWorkDir,
    projectWorkspacePath,
    personalWorkspacePath,
    isProjectCodeMode,
  };
}

/**
 * Folder picks from elsewhere in the shell: a fresh task adopts the folder,
 * an existing thread opens it in a new task instead of rebinding.
 */
export function useWorkDirSelection({
  isNewThread,
  effectiveAgentId,
  effectiveWorkDir,
  hintedWorkspacePath,
  handleWorkDirChange,
}: {
  isNewThread: boolean;
  effectiveAgentId: string;
  effectiveWorkDir: string;
  hintedWorkspacePath: string;
  handleWorkDirChange: (dir: string) => void;
}) {
  const openWorkDirInNewTask = useCallback(
    (dir: string) => {
      const next = dir.trim();
      if (!isAbsolutePath(next)) return;
      const route = taskWorkspaceRoute({
        agentId: effectiveAgentId,
        workspacePath: next,
      });
      const opened = window.open(
        new URL(toHashRouterShellUrl(route), window.location.origin).toString(),
        "_blank",
        "noopener,noreferrer",
      );
      if (opened) opened.opener = null;
    },
    [effectiveAgentId],
  );
  useEffect(() => {
    const handler = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      if (!path || !isAbsolutePath(path)) return;
      if (isNewThread) {
        handleWorkDirChange(path);
        return;
      }
      if (normalizeWorkDirKey(path) !== normalizeWorkDirKey(effectiveWorkDir)) {
        openWorkDirInNewTask(path);
      }
    };
    window.addEventListener("echo:workdir-selected", handler);
    return () =>
      window.removeEventListener("echo:workdir-selected", handler);
  }, [
    effectiveWorkDir,
    handleWorkDirChange,
    isNewThread,
    openWorkDirInNewTask,
  ]);
  const routeWorkspaceHintKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isNewThread || !hintedWorkspacePath) return;
    const key = normalizeWorkDirKey(hintedWorkspacePath);
    if (routeWorkspaceHintKeyRef.current === key) return;
    routeWorkspaceHintKeyRef.current = key;
    handleWorkDirChange(hintedWorkspacePath);
  }, [handleWorkDirChange, hintedWorkspacePath, isNewThread]);

  return openWorkDirInNewTask;
}
