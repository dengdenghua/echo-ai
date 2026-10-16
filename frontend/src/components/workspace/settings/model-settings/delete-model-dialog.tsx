import { AlertTriangleIcon, Trash2Icon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModelSettingsPageCopy } from "@/core/i18n/locales/model-settings";
import type { Translations } from "@/core/i18n/locales/types";

import type { ModelConfig } from "./custom-models";

/** Confirms deleting a custom model, warning when it is the current default. */
export function DeleteModelDialog({
  t,
  pageCopy,
  modelToDelete,
  setModelToDelete,
  deletingModel,
  deleteModelConfig,
  deletingCurrentDefault,
  deleteReplacement,
  doDeleteModel,
}: {
  t: Translations;
  pageCopy: ModelSettingsPageCopy;
  modelToDelete: string | null;
  setModelToDelete: Dispatch<SetStateAction<string | null>>;
  deletingModel: boolean;
  deleteModelConfig: ModelConfig | undefined;
  deletingCurrentDefault: boolean;
  deleteReplacement: string | null;
  doDeleteModel: (modelId: string) => Promise<boolean>;
}) {
  return (
    <Dialog
      open={modelToDelete !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !deletingModel) setModelToDelete(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[min(360px,calc(100vw-2rem))] gap-3 rounded-lg p-4 shadow-xl sm:max-w-[360px]"
      >
        <DialogHeader className="gap-1 text-left">
          <DialogTitle className="text-base">
            {t.settings.model.deleteModelTitle}
          </DialogTitle>
          <DialogDescription className="text-caption leading-5">
            {modelToDelete
              ? t.settings.model.deleteConfirm(
                  deleteModelConfig?.display_name ||
                    deleteModelConfig?.name ||
                    modelToDelete,
                )
              : ""}
          </DialogDescription>
          {deletingCurrentDefault && (
            <div className="mt-2 flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs leading-5 text-warning dark:border-warning/25 dark:bg-warning/10 dark:text-warning">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{pageCopy.deletingDefault(deleteReplacement)}</span>
            </div>
          )}
        </DialogHeader>
        <DialogFooter className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={deletingModel}
            onClick={() => setModelToDelete(null)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-caption font-medium text-foreground/80 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={deletingModel}
            onClick={async () => {
              if (!modelToDelete) return;
              const target = modelToDelete;
              const deleted = await doDeleteModel(target);
              if (deleted) setModelToDelete(null);
            }}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-destructive/25 bg-destructive/[0.07] px-3 text-caption font-medium text-destructive transition-colors hover:border-destructive/35 hover:bg-destructive/[0.11] disabled:pointer-events-none disabled:opacity-60"
          >
            {deletingModel ? (
              <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
            {t.common.delete}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
