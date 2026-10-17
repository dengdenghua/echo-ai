import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { swallow } from "@/core/utils/log";
import { authHeaders } from "@/core/auth/api";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import {
  listWorkspaces,
  getWorkspaceExecutionDirectory,
  type Workspace,
} from "@/core/workspace/api";
import { pickLocalDirectory } from "@/core/workspace/pick-local-directory";
import { isAbsolutePath } from "@/lib/path-utils";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/providers/AuthProvider";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useProjects } from "@/core/projects/hooks";
import { managedWorkdirThreadId, workdirDisplayName } from "./workdir-label";
import { MountPointDialog } from "./mount-point-dialog";
import { SharedSpacesDialog } from "./shared-spaces-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCAL_WORK_LOCATION } from "@/core/execution/work-location";
import {
  useWorkLocationMenu,
  WorkLocationIcon,
  type WorkLocationBinding,
} from "./work-location-picker";
import { useWorkdirMenuPosition } from "./use-workdir-menu-position";
import {
  WorkdirFolderBrowser,
  WorkdirFolderPickerCta,
  WorkdirRecentList,
} from "./workdir-local-sections";
import { WorkdirLocationItems } from "./workdir-location-items";
import { WorkdirRemotePanel } from "./workdir-remote-panel";
import {
  MAX_RECENT_WORKDIRS,
  dedupeDirEntries,
  dedupePaths,
  normalizePathKey,
  parentDir,
  readRecentWorkdirs,
  browseEntryPath,
  writeRecentWorkdirs,
  type FsTreeEntry,
} from "./workdir-selector-utils";

interface WorkDirSelectorProps {
  threadId?: string;
  workDir: string;
  onWorkDirChange?: (dir: string) => void;
  lockToCurrentThread?: boolean;
  onOpenWorkDirInNewTask?: (dir: string) => void;
  className?: string;
  variant?: "default" | "muted";
  chromeless?: boolean;
  designSpace?: boolean;
  /** When true, adds a "Remote mount" tab to the dropdown. */
  enableRemoteTab?: boolean;
  /** Active remote workspace id, if the thread is bound to one. */
  workspaceId?: string | null;
  /** Fired when the user picks a remote workspace in the Remote tab. */
  onWorkspaceIdChange?: (workspaceId: string) => void;
  /**
   * Where the conversation runs. When given, this one control picks both the
   * location (the icon) and the address (the label): this computer's folder,
   * or an execution node / WSL / SSH connection.
   */
  location?: WorkLocationBinding;
}

// Kept self-contained (not in the shared i18n bundle) so this touch-up stays
// decoupled from concurrently-edited locale files.
const WEB_PICKER_HINT: Record<"zh" | "en" | "ja" | "ko", string> = {
  zh: "未能打开系统文件夹选择器。你仍可选择最近使用的工作区，或在下方粘贴完整路径。",
  en: "The system folder picker could not be opened. Choose a recent workspace or paste its full path below.",
  ja: "システムのフォルダ選択を開けませんでした。最近のワークスペースを選ぶか、完全なパスを貼り付けてください。",
  ko: "시스템 폴더 선택기를 열 수 없습니다. 최근 작업 공간을 선택하거나 전체 경로를 붙여넣으세요.",
};

const LOCKED_WORKDIR_TEXT: Record<
  "zh" | "en" | "ja" | "ko",
  { triggerTitle: string; hint: string; openFolder: string }
> = {
  zh: {
    triggerTitle: "当前任务已绑定工作区",
    hint: "当前对话已绑定这个工作区。选择其他工作区会打开一个新任务，避免上下文和权限混在一起。",
    openFolder: "在新任务打开其他工作区",
  },
  en: {
    triggerTitle: "Current task is bound to this workspace",
    hint: "This conversation is bound to its workspace. Choosing another workspace opens a new task so context and permissions stay separate.",
    openFolder: "Open another workspace in a new task",
  },
  ja: {
    triggerTitle: "このタスクは現在のワークスペースに固定されています",
    hint: "この会話は現在のワークスペースに固定されています。別のワークスペースは新しいタスクで開き、文脈と権限を分けます。",
    openFolder: "別のワークスペースを新しいタスクで開く",
  },
  ko: {
    triggerTitle: "현재 작업은 이 작업 공간에 고정되어 있습니다",
    hint: "이 대화는 현재 작업 공간에 고정되어 있습니다. 다른 작업 공간은 새 작업으로 열어 컨텍스트와 권한을 분리합니다.",
    openFolder: "다른 작업 공간을 새 작업으로 열기",
  },
};

function webPickerHint(locale: string): string {
  const lang = (locale || "en").slice(0, 2).toLowerCase();
  if (lang === "zh") return WEB_PICKER_HINT.zh;
  if (lang === "ja") return WEB_PICKER_HINT.ja;
  if (lang === "ko") return WEB_PICKER_HINT.ko;
  return WEB_PICKER_HINT.en;
}

function lockedWorkdirText(locale: string) {
  const lang = (locale || "en").slice(0, 2).toLowerCase();
  if (lang === "zh") return LOCKED_WORKDIR_TEXT.zh;
  if (lang === "ja") return LOCKED_WORKDIR_TEXT.ja;
  if (lang === "ko") return LOCKED_WORKDIR_TEXT.ko;
  return LOCKED_WORKDIR_TEXT.en;
}

export function WorkDirSelector({
  threadId,
  workDir,
  onWorkDirChange,
  lockToCurrentThread = false,
  onOpenWorkDirInNewTask,
  className,
  variant = "default",
  chromeless = false,
  designSpace = false,
  enableRemoteTab = true,
  workspaceId,
  onWorkspaceIdChange,
  location,
}: WorkDirSelectorProps) {
  const isMutedVariant = variant === "muted";
  const { t, locale } = useI18n();
  const personalSpaceLabel = designSpace
    ? locale.toLowerCase().startsWith("zh")
      ? "创作空间"
      : "Creative space"
    : t.codeMode.personalSpace;
  const { authStatus, isAuthenticated, isLoading: authLoading } = useAuth();
  const featureFlags = useFeatureFlags();
  const remoteWorkspaceEnabled =
    !featureFlags.loading && featureFlags.isOn("ui.remote_workspace");
  const trRemote = t.remoteWorkspace;
  const [isPicking, setIsPicking] = useState(false);
  const pickerRequestRef = useRef<AbortController | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const workLocation = useWorkLocationMenu(location, showMenu);
  const runsElsewhere = workLocation.label !== null;
  const [mountOpen, setMountOpen] = useState(false);
  const [sharedOpen, setSharedOpen] = useState(false);
  // ``browsePath`` drives the in-menu folder browser. When the user
  // hasn't chosen anything yet we seed it from the most recently used
  // directory so the picker isn't pointing at an empty string (which
  // the backend's /api/fs/tree rejects).
  const [browsePath, setBrowsePath] = useState(() => {
    if (workDir) return workDir;
    if (typeof window === "undefined") return "";
    try {
      const recent = readRecentWorkdirs();
      if (recent.length > 0) return recent[0]!;
    } catch (e) {
      swallow(e);
    }
    return "";
  });
  const [browseEntries, setBrowseEntries] = useState<FsTreeEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [recentWorkdirs, setRecentWorkdirs] = useState<string[]>(() =>
    readRecentWorkdirs(),
  );
  const [manualPath, setManualPath] = useState(workDir);
  const [isBrowserOpen, setBrowserOpen] = useState(
    () => !isMutedVariant && !workDir,
  );
  // True when the user just hit the "pick folder" CTA but no Electron bridge
  // is present (i.e. running in a plain browser). We surface the manual input
  // and a one-line hint instead of silently doing nothing. Resets once the
  // user enters a path or closes the menu.
  const [noBridgeHint, setNoBridgeHint] = useState(false);
  useEffect(() => {
    const openPicker = () => {
      setShowMenu(true);
      setBrowserOpen(true);
      requestAnimationFrame(() => manualInputRef.current?.focus());
    };
    window.addEventListener("echo:open-workspace-picker", openPicker);
    return () =>
      window.removeEventListener("echo:open-workspace-picker", openPicker);
  }, []);
  // Remote workspace list (loaded when the Remote tab is enabled and the
  // menu opens). Stored at the component level so the second open is instant.
  const [remoteWorkspaces, setRemoteWorkspaces] = useState<Workspace[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  // Active tab inside the dropdown — defaults to "local" so existing
  // users see the same UI as before. We only switch to "remote" if
  // the parent has bound the thread to a workspace_id already.
  const [menuTab, setMenuTab] = useState<"local" | "remote">(
    workspaceId ? "remote" : "local",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const pendingBrowserPickedNameRef = useRef("");
  const { data: projects = [] } = useProjects(Boolean(managedWorkdirThreadId(workDir)) && !authLoading && (isAuthenticated || authStatus?.enabled === false));
  const managedLabel = locale.startsWith("zh") ? "任务工作区" : locale.startsWith("ja") ? "タスクのワークスペース" : locale.startsWith("ko") ? "작업 공간" : "Task workspace";
  const folderName = useMemo(
    () => workdirDisplayName(workDir, projects, managedLabel),
    [workDir, projects, managedLabel],
  );
  const lockedCopy = lockedWorkdirText(locale);
  const isEmpty = !workDir;
  const isWorkDirLocked = lockToCurrentThread;
  const emptyTriggerLabel = isMutedVariant
    ? personalSpaceLabel
    : t.codeMode.chooseWorkspaceFolder;
  const triggerLabel =
    !isEmpty && isMutedVariant
      ? folderName
      : isEmpty
        ? emptyTriggerLabel
        : folderName;
  const folderPickerLabel = isWorkDirLocked
    ? lockedCopy.openFolder
    : isMutedVariant
      ? t.codeMode.chooseWorkspaceFolder
      : t.codeMode.openFolderCta;
  const triggerTitle = isEmpty
    ? emptyTriggerLabel
    : isWorkDirLocked
      ? `${lockedCopy.triggerTitle}: ${workDir}`
      : `${t.codeMode.chooseWorkspaceFolder}: ${workDir}`;
  const _menuToggleTitle = isMutedVariant
    ? t.codeMode.chooseWorkspaceFolder
    : t.codeMode.recentWorkspaces;
  const emptyTriggerClass = isMutedVariant
    ? "text-muted-foreground"
    : "text-muted-foreground";
  const activeTriggerClass = isMutedVariant
    ? "text-foreground"
    : "text-foreground";

  const applyWorkDir = useCallback(
    (dir: string) => {
      const next = dir.trim();
      if (!next || !isAbsolutePath(next)) return;
      if (isWorkDirLocked) {
        if (normalizePathKey(next) !== normalizePathKey(workDir)) {
          onOpenWorkDirInNewTask?.(next);
        }
        setShowMenu(false);
        setNoBridgeHint(false);
        return;
      }
      onWorkDirChange?.(next);
      setBrowsePath(next);
      setRecentWorkdirs((prev) => {
        const merged = dedupePaths([next, ...prev]).slice(
          0,
          MAX_RECENT_WORKDIRS,
        );
        writeRecentWorkdirs(merged);
        return merged;
      });
      setShowMenu(false);
      setNoBridgeHint(false);
    },
    [isWorkDirLocked, onOpenWorkDirInNewTask, onWorkDirChange, workDir],
  );

  const clearWorkDir = useCallback(() => {
    onWorkDirChange?.("");
    setManualPath("");
    setShowMenu(false);
  }, [onWorkDirChange]);

  const loadDirectories = useCallback(async (path: string) => {
    if (!path) {
      setBrowseLoading(true);
      try {
        const res = await fetch(`${getBackendBaseURL()}/api/fs/roots`, {
          headers: authHeaders(),
        });
        const data = await res.json();
        const entries = Array.isArray(data?.entries)
          ? data.entries
          : Array.isArray(data)
            ? data
            : [];
        setBrowseEntries(
          dedupeDirEntries(
            entries.filter((entry: FsTreeEntry) => entry.type === "dir"),
          ),
        );
      } catch (e) {
        swallow(e);
        setBrowseEntries([]);
      } finally {
        setBrowseLoading(false);
      }
      return;
    }
    setBrowseLoading(true);
    try {
      const res = await fetch(
        `${getBackendBaseURL()}/api/fs/tree?path=${encodeURIComponent(path)}&depth=1`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      const entries = Array.isArray(data?.entries)
        ? data.entries
        : Array.isArray(data)
          ? data
          : [];
      setBrowseEntries(
        dedupeDirEntries(
          entries.filter((entry: FsTreeEntry) => entry.type === "dir"),
        ),
      );
    } catch (e) {
      swallow(e);
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  // Refresh when opening the menu while keeping the previous list visible.
  const loadRemoteWorkspaces = useCallback(async () => {
    if (!enableRemoteTab || !remoteWorkspaceEnabled) return;
    const canReadRemoteWorkspaces =
      !authLoading && (authStatus?.enabled === false || isAuthenticated);
    if (!canReadRemoteWorkspaces) {
      setRemoteWorkspaces([]);
      setRemoteError(null);
      return;
    }
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const list = await listWorkspaces();
      setRemoteWorkspaces(list);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setRemoteError(message);
      swallow(e);
    } finally {
      setRemoteLoading(false);
    }
  }, [
    authLoading,
    authStatus?.enabled,
    enableRemoteTab,
    isAuthenticated,
    remoteWorkspaceEnabled,
  ]);

  // Reload once per menu opening; empty/error results must not loop.
  useEffect(() => {
    if (!showMenu || !enableRemoteTab || !remoteWorkspaceEnabled) return;
    void loadRemoteWorkspaces();
  }, [
    showMenu,
    enableRemoteTab,
    remoteWorkspaceEnabled,
    loadRemoteWorkspaces,
  ]);

  const handlePickRemote = useCallback(
    async (workspace: Workspace) => {
      setRemoteLoading(true);
      setRemoteError(null);
      try {
        const directory = await getWorkspaceExecutionDirectory(workspace.id);
        applyWorkDir(directory);
        if (!isWorkDirLocked) onWorkspaceIdChange?.(workspace.id);
        setShowMenu(false);
        setNoBridgeHint(false);
      } catch (error) {
        setRemoteError(error instanceof Error ? error.message : String(error));
      } finally {
        setRemoteLoading(false);
      }
    },
    [applyWorkDir, isWorkDirLocked, onWorkspaceIdChange],
  );

  useEffect(() => {
    if (!workDir) return;
    setManualPath(workDir);
    setBrowsePath(workDir);
    setRecentWorkdirs((prev) => {
      const merged = dedupePaths([workDir, ...prev]).slice(
        0,
        MAX_RECENT_WORKDIRS,
      );
      writeRecentWorkdirs(merged);
      return merged;
    });
  }, [workDir]);

  useEffect(() => {
    if (!showMenu) return;
    if (isMutedVariant && !noBridgeHint) return;
    void loadDirectories(browsePath);
  }, [isMutedVariant, noBridgeHint, showMenu, browsePath, loadDirectories]);

  useEffect(() => {
    if (!showMenu) return;
    const pendingName = pendingBrowserPickedNameRef.current;
    pendingBrowserPickedNameRef.current = "";
    setManualPath(pendingName || workDir);
    if (!workDir && (!isMutedVariant || noBridgeHint)) setBrowserOpen(true);
  }, [isMutedVariant, noBridgeHint, showMenu, workDir]);

  // With a location binding a Radix cascading menu owns open/close. Typing a
  // path needs a text field, which a menu cannot hold: when the system folder
  // picker is unavailable, fall back to the folder popover.
  const cascadingMenu = Boolean(location) && !noBridgeHint;
  useEffect(() => {
    if (cascadingMenu ? !isPicking : !showMenu && !isPicking) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        pickerRequestRef.current?.abort();
        setIsPicking(false);
        if (!cascadingMenu) setShowMenu(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      pickerRequestRef.current?.abort();
      setIsPicking(false);
      setShowMenu(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showMenu, isPicking, cascadingMenu]);

  // The typed-path fallback ends with its popover; next time the location
  // menu opens again.
  useEffect(() => {
    if (location && !showMenu) setNoBridgeHint(false);
  }, [location, showMenu]);

  useEffect(() => () => pickerRequestRef.current?.abort(), []);

  const handlePrimaryAction = useCallback(async () => {
    if (isPicking) {
      pickerRequestRef.current?.abort();
      setIsPicking(false);
      return;
    }
    const request = new AbortController();
    pickerRequestRef.current = request;
    setIsPicking(true);
    try {
      const selected = await pickLocalDirectory(workDir, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      if (selected) {
        applyWorkDir(selected);
      }
      return;
    } catch (error) {
      if (request.signal.aborted) return;
      swallow(error);
      setNoBridgeHint(true);
      setBrowserOpen(true);
    } finally {
      if (pickerRequestRef.current === request) setIsPicking(false);
    }

    setShowMenu(true);
    if (!isMutedVariant) setBrowserOpen(true);
    requestAnimationFrame(() => {
      if (!request.signal.aborted) manualInputRef.current?.focus();
    });
  }, [applyWorkDir, isMutedVariant, isPicking, workDir]);

  const handleManualSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      applyWorkDir(manualPath);
    },
    [applyWorkDir, manualPath],
  );

  const menuRect = useWorkdirMenuPosition({
    containerRef,
    showMenu,
    isMutedVariant,
    noBridgeHint,
  });

  const handleEnterDirectory = useCallback(
    (entryPath: string) => {
      setBrowsePath(browseEntryPath(browsePath, entryPath));
    },
    [browsePath],
  );

  const upDir = parentDir(browsePath);

  const folderPickerCta = (
    <WorkdirFolderPickerCta
      isMutedVariant={isMutedVariant}
      isPicking={isPicking}
      label={folderPickerLabel}
      onClick={() => void handlePrimaryAction()}
    />
  );

  const manualPathForm = (
    <form
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-border-default bg-background/70 p-1 shadow-inner"
      onSubmit={handleManualSubmit}
    >
      <input
        ref={manualInputRef}
        aria-label={t.codeMode.selectWorkspace}
        value={manualPath}
        onChange={(event) => setManualPath(event.target.value)}
        placeholder={t.codeMode.selectWorkspace}
        className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!isAbsolutePath(manualPath)}
        className={cn(
          "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
          isAbsolutePath(manualPath)
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "cursor-not-allowed bg-muted text-muted-foreground",
        )}
      >
        {t.common.confirm}
      </button>
    </form>
  );

  const localMenuContent = (
    <div
      className={cn(
        "flex max-h-full flex-col overflow-hidden",
        // When wrapped in Tabs we drop the outer chrome — Tabs adds its own
        // border/rounded corners. When standalone we keep the original frame.
        remoteWorkspaceEnabled
          ? ""
          : "border border-border-default bg-popover/95 backdrop-blur " +
              (isMutedVariant
                ? "rounded-lg shadow-[var(--shadow-md)]"
                : "rounded-lg shadow-2xl"),
      )}
    >
      {/* The same system picker is available in both the desktop shell and the
          local web app; the backend supplies the absolute path in web mode. */}
      <div className={cn("shrink-0", isMutedVariant ? "p-1.5" : "p-2.5")}>
        {isWorkDirLocked && (
          <div className="mt-1.5 rounded-md border border-primary/15 bg-primary/5 px-2 py-1.5 text-xs leading-snug text-muted-foreground">
            {lockedCopy.hint}
          </div>
        )}
        {!isWorkDirLocked && (
          <button
            type="button"
            onClick={clearWorkDir}
            aria-pressed={!workDir}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
              !workDir && "bg-muted/60 text-foreground",
              !isMutedVariant && "border border-border-default",
            )}
          >
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {personalSpaceLabel}
            </span>
            {!workDir && (
              <CheckIcon className="size-3.5 shrink-0 text-primary" />
            )}
          </button>
        )}

        {folderPickerCta}

        {noBridgeHint && (
          <div className="mt-2 rounded-md border border-border-default bg-muted/40 px-2 py-1.5 text-xs leading-snug text-muted-foreground">
            {webPickerHint(locale)}
          </div>
        )}
        {(!isMutedVariant || noBridgeHint) && manualPathForm}
      </div>

      {/* Recent workspaces — colored letter-tile + path subtitle + ✓ for the
          active one. Shown in the muted (web) menu too so there's a one-click
          way to rebind without a native picker. */}
      {(!isMutedVariant || recentWorkdirs.length > 0) && (
        <WorkdirRecentList
          recentWorkdirs={recentWorkdirs}
          workDir={workDir}
          isMutedVariant={isMutedVariant}
          onChoose={applyWorkDir}
        />
      )}

      {/* Advanced: in-page directory browser. Web-mode users without an
          Electron picker still need a way to navigate; native users will
          rarely open this. Collapsed by default so it doesn't dominate. */}
      {(!isMutedVariant || noBridgeHint) && (
        <WorkdirFolderBrowser
          open={isBrowserOpen}
          onOpenChange={setBrowserOpen}
          browsePath={browsePath}
          upDir={upDir}
          onBrowse={setBrowsePath}
          browseLoading={browseLoading}
          browseEntries={browseEntries}
          isMutedVariant={isMutedVariant}
          onEnterDirectory={handleEnterDirectory}
          onChoose={applyWorkDir}
        />
      )}
    </div>
  );

  const remoteMenuContent = (
    <WorkdirRemotePanel
      remoteWorkspaceEnabled={remoteWorkspaceEnabled}
      isMutedVariant={isMutedVariant}
      threadId={threadId}
      workspaceId={workspaceId}
      remoteWorkspaces={remoteWorkspaces}
      remoteLoading={remoteLoading}
      remoteError={remoteError}
      onRefresh={() => void loadRemoteWorkspaces()}
      onPick={(ws) => void handlePickRemote(ws)}
      onConnectSharedDirectory={() => {
        setShowMenu(false);
        setMountOpen(true);
      }}
      onAttachSharedSpace={() => {
        setShowMenu(false);
        setSharedOpen(true);
      }}
    />
  );

  // When the remote tab is enabled we wrap the two panels in a shadcn Tabs
  // so the user can flip between local-folder and remote-mount entry
  // points. Otherwise we render the local panel as before — no visual
  // change for existing callers.
  const menuContent = remoteWorkspaceEnabled && enableRemoteTab ? (
    <div
      className={cn(
        "flex max-h-full flex-col overflow-hidden rounded-lg border border-border-default bg-popover/95 backdrop-blur",
        isMutedVariant ? "shadow-[var(--shadow-md)]" : "shadow-2xl",
      )}
    >
      <Tabs
        value={menuTab}
        onValueChange={(value) => setMenuTab(value as "local" | "remote")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-2 mt-2 grid h-8 shrink-0 grid-cols-2 rounded-md bg-muted/50">
          <TabsTrigger value="local" className="text-xs">
            {trRemote.localTab}
          </TabsTrigger>
          <TabsTrigger value="remote" className="text-xs">
            {trRemote.remoteTab}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="local"
          className="mt-0 min-h-0 flex-1 overflow-y-auto"
        >
          {localMenuContent}
        </TabsContent>
        <TabsContent
          value="remote"
          className="mt-0 min-h-0 flex-1 overflow-y-auto"
        >
          {remoteMenuContent}
        </TabsContent>
      </Tabs>
    </div>
  ) : (
    localMenuContent
  );
  // With a location binding the trigger opens a cascading menu: one row per
  // location, and 本地 opens the folders this computer can work in. Picking a
  // folder also makes this computer the location again. Shared spaces keep
  // their own switcher in the sidebar.
  const runsLocally = !runsElsewhere;
  const toLocal = () => {
    if (location && location.value.kind !== "local") {
      location.onChange(LOCAL_WORK_LOCATION);
    }
  };
  const chooseFolder = (dir: string) => {
    toLocal();
    if (normalizePathKey(dir) !== normalizePathKey(workDir)) applyWorkDir(dir);
  };
  // The current folder is always listed, even when it never was "recent"
  // (e.g. a shared space or a folder set by a project).
  const folders = dedupePaths([
    ...(workDir ? [workDir] : []),
    ...recentWorkdirs,
  ]).slice(0, MAX_RECENT_WORKDIRS);
  const locationLocalItems = (
    <WorkdirLocationItems
      isWorkDirLocked={isWorkDirLocked}
      lockedHint={lockedCopy.hint}
      lockedOpenFolderLabel={lockedCopy.openFolder}
      personalSpaceLabel={personalSpaceLabel}
      runsLocally={runsLocally}
      workDir={workDir}
      folderName={folderName}
      folders={folders}
      isPicking={isPicking}
      onSelectPersonalSpace={() => {
        toLocal();
        if (workDir) clearWorkDir();
      }}
      onChooseFolder={chooseFolder}
      onPickFolder={() => {
        toLocal();
        void handlePrimaryAction();
      }}
    />
  );
  const shownLabel = workLocation.label ?? triggerLabel;
  const shownTitle = runsElsewhere
    ? [workLocation.label, workLocation.detail].filter(Boolean).join(" · ")
    : triggerTitle;

  const triggerButton = (
    <button
      className={cn(
        "group flex min-w-0 max-w-full items-center gap-1.5 text-ui font-medium shadow-none transition-colors duration-base",
        chromeless
          ? "h-8 rounded-lg px-1.5 text-muted-foreground hover:bg-muted/55 hover:text-foreground"
          : "h-8 rounded-lg border border-transparent bg-transparent px-2 text-muted-foreground hover:border-border-default hover:bg-muted/55 hover:text-foreground",
        isEmpty && !runsElsewhere ? emptyTriggerClass : activeTriggerClass,
        isPicking && "cursor-wait opacity-50",
      )}
      onClick={() => {
        if (isPicking) void handlePrimaryAction();
        else if (!cascadingMenu) setShowMenu((open) => !open);
      }}
      aria-expanded={showMenu}
      aria-busy={isPicking}
      title={isPicking ? t.common.cancel : shownTitle}
      type="button"
      data-testid={location ? "work-location-trigger" : undefined}
    >
      {location ? (
        <WorkLocationIcon location={workLocation.value} className="size-3.5 shrink-0" />
      ) : (
        <FolderOpenIcon className="size-3.5 shrink-0" />
      )}
      <span
        className={cn(
          isMutedVariant
            ? "min-w-0 max-w-[120px] truncate"
            : "max-w-[160px] truncate",
          isEmpty ? "font-medium" : "tracking-normal",
        )}
      >
        {isPicking ? t.common.cancel : shownLabel}
      </span>
      {workLocation.unhealthy ? (
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
      ) : null}
      <ChevronDownIcon className="size-3 shrink-0 opacity-35 transition-opacity group-hover:opacity-60" />
    </button>
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative flex items-center gap-1.5", className)}
    >
      {cascadingMenu ? (
        <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-56"
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {workLocation.renderMenu({
              localItems: locationLocalItems,
              localSummary: workDir ? folderName : personalSpaceLabel,
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        triggerButton
      )}

      {!cascadingMenu && menuRect && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[100]"
              style={{
                top:
                  menuRect.top !== undefined ? `${menuRect.top}px` : undefined,
                bottom:
                  menuRect.bottom !== undefined
                    ? `${menuRect.bottom}px`
                    : undefined,
                left: `${menuRect.left}px`,
                width: `${menuRect.width}px`,
                maxHeight: `${menuRect.maxHeight}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {menuContent}
            </div>,
            document.body,
          )
        : null}
      {remoteWorkspaceEnabled && enableRemoteTab && <MountPointDialog
        open={mountOpen} onOpenChange={setMountOpen} defaultMountType="local"
        onCreated={(workspace) => {
          setRemoteWorkspaces(prev => [...prev.filter(ws => ws.id !== workspace.id), workspace]);
          setMenuTab("remote");
          setShowMenu(true);
        }}
      />}
      {workLocation.dialogs}
      {remoteWorkspaceEnabled && enableRemoteTab && threadId && threadId !== "new" && <SharedSpacesDialog
        key={threadId} threadId={threadId} open={sharedOpen} onOpenChange={setSharedOpen}
      />}
    </div>
  );
}
