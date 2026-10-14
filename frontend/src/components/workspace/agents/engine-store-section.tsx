/**
 * HUB 应用 · 「执行引擎」: install, update or remove Codex and OpenCode.
 *
 * The desktop installer no longer carries the engines; this group downloads
 * the pinned build on demand. Engines are machine-wide, so only the instance
 * admin is offered the actions, like workbench packages.
 */
import {
  CloudDownloadIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  CodexIcon,
  OpenCodeIcon,
} from "@/components/workspace/execution-engine-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  engineProgress,
  useEngineAction,
  useEngines,
  type EngineAction,
  type EngineStatus,
} from "@/core/engines/api";
import {
  engineNeedsInstall,
  engineStatusLine,
} from "@/core/engines/status-line";
import { useI18n } from "@/core/i18n/hooks";
import {
  engineStoreCopy,
  type EngineStoreCopy,
} from "@/core/i18n/locales/engine-store";
import {
  useCanManageWorkbenches,
  workbenchActionErrorMessage,
} from "@/core/workbench/workbench-permissions";

const STATUS_LINE = "mt-0.5 block text-micro";

function engineIcon(id: string) {
  return id === "opencode" ? (
    <OpenCodeIcon className="size-[18px] overflow-hidden rounded" />
  ) : (
    <CodexIcon className="block size-[18px]" />
  );
}

function EngineRow({
  engine,
  copy,
  canManage,
  pending,
  onAction,
}: {
  engine: EngineStatus;
  copy: EngineStoreCopy;
  canManage: boolean;
  pending: boolean;
  onAction: (action: EngineAction) => void;
}) {
  const status = engineStatusLine(engine, copy);
  const installing = engine.state === "installing";
  const description =
    copy.descriptions[engine.id === "opencode" ? "opencode" : "codex"];
  // A store install of the pinned version is the only thing to manage; a
  // bundled or configured engine is the app's, not the store's.
  const needsInstall =
    engineNeedsInstall(engine) ||
    (engine.supported &&
      engine.state === "ready" &&
      engine.source === "system");
  return (
    <div
      className="group relative border-b border-border-subtle transition-colors hover:bg-muted/25"
      data-testid={`engine-${engine.id}`}
    >
      <div className="flex min-h-16 w-full items-center gap-3 px-2 py-2 pr-24 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted ring-1 ring-inset ring-border">
          {engineIcon(engine.id)}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">
            {engine.name}
          </span>
          <span className="mt-0.5 block truncate text-ui text-muted-foreground">
            {description}
          </span>
          <span
            role={status.tone === "destructive" ? "alert" : undefined}
            className={`${STATUS_LINE} ${
              status.tone === "destructive"
                ? "text-destructive"
                : status.tone === "primary"
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            {status.text}
          </span>
          {installing ? (
            <span
              className="mt-1 block h-1 w-40 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={status.text}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={engineProgress(engine)}
            >
              <span
                className="block h-full bg-primary transition-[width]"
                style={{ width: `${engineProgress(engine)}%` }}
              />
            </span>
          ) : null}
        </span>
      </div>
      {installing ? (
        <span className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center px-2">
          <Loader2Icon className="size-4 animate-spin text-primary" />
        </span>
      ) : needsInstall && !canManage ? (
        <span className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" aria-hidden="true" />
          {copy.adminOnly}
        </span>
      ) : needsInstall ? (
        <button
          type="button"
          aria-label={copy.installEngine(engine.name)}
          disabled={pending}
          onClick={() => onAction("install")}
          className="absolute right-2 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 px-2 text-micro font-medium text-primary transition-colors hover:text-primary/75 disabled:text-muted-foreground"
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : engine.state === "update_available" ? (
            <RefreshCwIcon className="size-3.5" />
          ) : (
            <CloudDownloadIcon className="size-3.5" />
          )}
          {engine.state === "update_available" ? copy.update : copy.install}
        </button>
      ) : engine.can_uninstall && canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
              aria-label={copy.manage(engine.name)}
              title={copy.manage(engine.name)}
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onAction("uninstall")}
            >
              <Trash2Icon className="size-4" />
              {copy.uninstall}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function EngineStoreSection() {
  const { locale } = useI18n();
  const copy = engineStoreCopy(locale);
  const canManage = useCanManageWorkbenches();
  const engines = useEngines();
  const action = useEngineAction();
  const run = (engine: EngineStatus, kind: EngineAction) =>
    action.mutate(
      { id: engine.id, action: kind },
      { onError: (error) => toast.error(workbenchActionErrorMessage(error)) },
    );
  return (
    <div className="mb-6" data-testid="engine-store">
      <h3 className="mb-1 text-sm font-semibold">{copy.sectionTitle}</h3>
      <p className="mb-2 max-w-3xl text-ui text-muted-foreground">
        {copy.sectionHint}
      </p>
      {engines.isError ? (
        <p role="alert" className="py-2 text-ui text-muted-foreground">
          {copy.unavailable}
        </p>
      ) : null}
      <div className="grid gap-x-8 sm:grid-cols-2">
        {(engines.data?.engines ?? []).map((engine) => (
          <EngineRow
            key={engine.id}
            engine={engine}
            copy={copy}
            canManage={canManage}
            pending={action.isPending && action.variables?.id === engine.id}
            onAction={(kind) => run(engine, kind)}
          />
        ))}
      </div>
    </div>
  );
}
