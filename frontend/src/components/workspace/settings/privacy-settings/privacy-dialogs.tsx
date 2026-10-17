import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/core/i18n/hooks";

import { getSettingsUxCopy } from "../settings-ux-copy";

import { isAbsoluteLikePath } from "./privacy-helpers";

export function AddDenylistPathDialog({
  open,
  setOpen,
  busy,
  newPath,
  setNewPath,
  onAdd,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  busy: boolean;
  newPath: string;
  setNewPath: (path: string) => void;
  onAdd: () => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogContent closeLabel={t.common.close} className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t.privacySettings.addPathDialogTitle}</DialogTitle>
          <DialogDescription>
            {t.privacySettings.addPathDialogDesc}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && isAbsoluteLikePath(newPath.trim())) {
              void onAdd();
            }
          }}
        >
          <Label htmlFor="denylist-path-input" className="text-sm">
            {t.privacySettings.pathLabel}
          </Label>
          <Input
            id="denylist-path-input"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="C:\\Users\\you\\secrets"
            className="h-9 font-mono text-xs"
            autoFocus
            required
            aria-invalid={
              newPath.trim().length > 0 && !isAbsoluteLikePath(newPath.trim())
            }
          />
          <DialogFooter className="gap-2 pt-1 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={busy || !isAbsoluteLikePath(newPath.trim())}
            >
              {busy ? t.common.loading : t.common.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDenylistPathDialog({
  pathToRemove,
  setPathToRemove,
  busy,
  onRemove,
}: {
  pathToRemove: string | null;
  setPathToRemove: (path: string | null) => void;
  busy: boolean;
  onRemove: (path: string) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const copy = getSettingsUxCopy(locale).privacy;

  return (
    <Dialog
      open={pathToRemove !== null}
      onOpenChange={(open) => {
        if (!open && !busy) setPathToRemove(null);
      }}
    >
      <DialogContent closeLabel={t.common.close} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {copy.removePathTitle}
          </DialogTitle>
          <DialogDescription>
            {pathToRemove ? copy.removePathDescription(pathToRemove) : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setPathToRemove(null)}
            disabled={busy}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!pathToRemove) return;
              const removed = await onRemove(pathToRemove);
              if (removed) setPathToRemove(null);
            }}
            disabled={busy}
          >
            {busy ? t.common.loading : copy.removePathConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FactoryResetDialog({
  open,
  setOpen,
  pending,
  confirmText,
  setConfirmText,
  onConfirm,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  pending: boolean;
  confirmText: string;
  setConfirmText: (text: string) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogContent closeLabel={t.common.close} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangleIcon className="size-5" />
            {t.accountSettings.factoryResetTitle}
          </DialogTitle>
          <DialogDescription>
            {t.accountSettings.factoryResetDialogDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <Label htmlFor="factory-reset-confirm" className="text-sm">
            {t.accountSettings.factoryResetTypeToConfirm}
          </Label>
          <Input
            id="factory-reset-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="RESET ECHO"
            className="h-9"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={confirmText !== "RESET ECHO" || pending}
          >
            {pending
              ? t.accountSettings.factoryResetPending
              : t.accountSettings.factoryResetConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
