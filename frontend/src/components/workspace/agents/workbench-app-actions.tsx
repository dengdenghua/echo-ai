/**
 * Per-app controls on the HUB 应用 cards.
 *
 * Workbench packages are machine-wide: installing, updating, enabling,
 * rolling back or removing one changes the app for every account on this
 * computer, so only the instance admin is offered those actions. Pinning an
 * app to the sidebar is personal and stays available to everyone.
 */
import {
  CirclePauseIcon,
  CloudDownloadIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WORKBENCH_ADMIN_ONLY_HINT,
  WORKBENCH_ADMIN_ONLY_LABEL,
} from "@/core/workbench/workbench-permissions";

const STATUS_LINE = "mt-0.5 block text-micro";

/** The one-line state under an app's name; click hints only for those who can act. */
export function WorkbenchStatusLine({
  canManage,
  isBroken,
  isIncompatible,
  isUpdateAvailable,
  isDisabled,
  hasRecoveries,
}: {
  canManage: boolean;
  isBroken: boolean;
  isIncompatible: boolean;
  isUpdateAvailable: boolean;
  isDisabled: boolean;
  hasRecoveries: boolean;
}) {
  if (isBroken || isIncompatible) {
    const state = isBroken ? "安装损坏" : "版本不兼容";
    const next = isBroken ? "修复" : "更新";
    return (
      <span className={`${STATUS_LINE} text-destructive`}>
        {state} · {canManage ? `点击${next}` : `需管理员${next}`}
      </span>
    );
  }
  if (isUpdateAvailable) {
    return <span className={`${STATUS_LINE} text-primary`}>有可用更新</span>;
  }
  if (isDisabled) {
    return (
      <span className={`${STATUS_LINE} text-warning`}>
        {canManage ? "已停用 · 点击重新启用" : "已停用 · 需管理员启用"}
      </span>
    );
  }
  if (hasRecoveries) {
    return <span className={`${STATUS_LINE} text-core`}>有可恢复的作品</span>;
  }
  return null;
}

/** The trailing control of an app that is not installed. */
export function WorkbenchInstallControl({
  appName,
  canManage,
  isInSidebar,
  hasRecoveries,
  isMutating,
  disabled,
  statusUnread,
  onRemoveFromSidebar,
  onInstall,
}: {
  appName: string;
  canManage: boolean;
  isInSidebar: boolean;
  hasRecoveries: boolean;
  isMutating: boolean;
  disabled: boolean;
  statusUnread: boolean;
  onRemoveFromSidebar: () => void;
  onInstall: () => void;
}) {
  if (!canManage && !isInSidebar && !statusUnread) {
    return (
      <span
        className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-xs text-muted-foreground"
        title={WORKBENCH_ADMIN_ONLY_HINT}
      >
        <LockIcon className="size-3.5" aria-hidden="true" />
        {WORKBENCH_ADMIN_ONLY_LABEL}
      </span>
    );
  }
  return (
    <button
      type="button"
      // The accessible name contains the visible verb (移除 / 恢复 / 安装) so
      // voice control finds it.
      aria-label={
        isInSidebar
          ? `从侧栏移除${appName}`
          : hasRecoveries
            ? `恢复${appName}`
            : `安装${appName}`
      }
      disabled={disabled}
      onClick={isInSidebar ? onRemoveFromSidebar : onInstall}
      className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-micro font-medium text-primary transition-colors hover:text-primary/75 disabled:text-muted-foreground"
    >
      {isMutating ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <CloudDownloadIcon className="size-3.5" />
      )}
      {statusUnread
        ? "状态未读取"
        : isInSidebar
          ? "移除"
          : isMutating
            ? "安装中"
            : hasRecoveries
              ? "恢复"
              : "安装"}
    </button>
  );
}

export type WorkbenchMenuOperation =
  | "install"
  | "enable"
  | "disable"
  | "rollback";

/** The 管理 menu of an installed app; package lifecycle items are admin-only. */
export function WorkbenchManageMenu({
  appName,
  canManage,
  isInSidebar,
  isRuntimeEnabled,
  isUpdateAvailable,
  needsRepair,
  rollbackOperation,
  onToggleSidebar,
  onOperation,
  onUninstall,
}: {
  appName: string;
  canManage: boolean;
  isInSidebar: boolean;
  isRuntimeEnabled: boolean;
  isUpdateAvailable: boolean;
  needsRepair: boolean;
  /** The operation a rollback would undo, or ``null`` when none is available. */
  rollbackOperation: string | null;
  onToggleSidebar: () => void;
  onOperation: (operation: WorkbenchMenuOperation) => void;
  onUninstall: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
          aria-label={`管理${appName}`}
          title={`管理${appName}`}
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onToggleSidebar}>
          <PanelLeftIcon className="size-4" />
          {isInSidebar ? "从侧栏移除" : "固定到侧栏"}
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuItem
              onSelect={() =>
                onOperation(isRuntimeEnabled ? "disable" : "enable")
              }
            >
              {isRuntimeEnabled ? (
                <CirclePauseIcon className="size-4" />
              ) : (
                <PowerIcon className="size-4" />
              )}
              {isRuntimeEnabled ? "停用应用" : "启用应用"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOperation("install")}>
              <RefreshCwIcon className="size-4" />
              {isUpdateAvailable
                ? "安装可用更新"
                : needsRepair
                  ? "重新安装修复"
                  : "重新安装"}
            </DropdownMenuItem>
            {rollbackOperation !== null ? (
              <DropdownMenuItem onSelect={() => onOperation("rollback")}>
                <RotateCcwIcon className="size-4" />
                {rollbackOperation === "update"
                  ? "回退上个版本"
                  : "撤销最近安装"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onUninstall}
            >
              <Trash2Icon className="size-4" /> 卸载
            </DropdownMenuItem>
          </>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {WORKBENCH_ADMIN_ONLY_HINT}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
