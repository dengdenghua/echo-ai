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
import { useI18n } from "@/core/i18n/hooks";
import { hubCopy } from "@/core/i18n/locales/hub";

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
  const copy = hubCopy(useI18n().locale).card;
  if (isBroken || isIncompatible) {
    const state = isBroken ? copy.broken : copy.incompatible;
    const next = isBroken ? copy.repair : copy.update;
    return (
      <span className={`${STATUS_LINE} text-destructive`}>
        {state} · {canManage ? copy.clickTo(next) : copy.adminTo(next)}
      </span>
    );
  }
  if (isUpdateAvailable) {
    return (
      <span className={`${STATUS_LINE} text-primary`}>
        {copy.updateAvailable}
      </span>
    );
  }
  if (isDisabled) {
    return (
      <span className={`${STATUS_LINE} text-warning`}>
        {canManage ? copy.disabledClick : copy.disabledAdmin}
      </span>
    );
  }
  if (hasRecoveries) {
    return (
      <span className={`${STATUS_LINE} text-core`}>{copy.recoverable}</span>
    );
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
  const copy = hubCopy(useI18n().locale).card;
  if (!canManage && !isInSidebar && !statusUnread) {
    return (
      <span
        className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-xs text-muted-foreground"
        title={copy.adminOnlyHint}
      >
        <LockIcon className="size-3.5" aria-hidden="true" />
        {copy.adminOnly}
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
          ? copy.removeFromSidebarOf(appName)
          : hasRecoveries
            ? copy.restoreOf(appName)
            : copy.installOf(appName)
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
        ? copy.statusUnread
        : isInSidebar
          ? copy.remove
          : isMutating
            ? copy.installing
            : hasRecoveries
              ? copy.restore
              : copy.install}
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
  const copy = hubCopy(useI18n().locale).card;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
          aria-label={copy.manageOf(appName)}
          title={copy.manageOf(appName)}
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onToggleSidebar}>
          <PanelLeftIcon className="size-4" />
          {isInSidebar ? copy.removeFromSidebar : copy.pinToSidebar}
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
              {isRuntimeEnabled ? copy.disableApp : copy.enableApp}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOperation("install")}>
              <RefreshCwIcon className="size-4" />
              {isUpdateAvailable
                ? copy.installUpdate
                : needsRepair
                  ? copy.reinstallRepair
                  : copy.reinstall}
            </DropdownMenuItem>
            {rollbackOperation !== null ? (
              <DropdownMenuItem onSelect={() => onOperation("rollback")}>
                <RotateCcwIcon className="size-4" />
                {rollbackOperation === "update"
                  ? copy.rollback
                  : copy.undoInstall}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onUninstall}
            >
              <Trash2Icon className="size-4" /> {copy.uninstall}
            </DropdownMenuItem>
          </>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {copy.adminOnlyHint}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
