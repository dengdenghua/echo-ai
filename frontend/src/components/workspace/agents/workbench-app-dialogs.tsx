/**
 * The two decisions HUB 应用 asks before changing a workbench app's data:
 * restoring work saved by an earlier uninstall, and what to do with the
 * work when uninstalling.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { hubCopy } from "@/core/i18n/locales/hub";
import { cn } from "@/lib/utils";

export function RestoreWorkbenchDialog({
  appName,
  open,
  onClose,
  onFreshInstall,
  onRestore,
}: {
  appName: string;
  open: boolean;
  onClose: () => void;
  onFreshInstall: () => void;
  onRestore: () => void;
}) {
  const copy = hubCopy(useI18n().locale).restore;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title(appName)}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-core/30 bg-core/8 p-3 text-sm">
          <span className="font-medium text-foreground">{copy.kept}</span>
          <p className="mt-1 text-ui leading-5 text-muted-foreground">
            {copy.safety}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFreshInstall}>
            {copy.fresh}
          </Button>
          <Button onClick={onRestore}>{copy.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UninstallWorkbenchDialog({
  appName,
  open,
  policy,
  busy,
  onPolicyChange,
  onClose,
  onConfirm,
}: {
  appName: string;
  open: boolean;
  policy: "keep" | "trash";
  busy: boolean;
  onPolicyChange: (policy: "keep" | "trash") => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const copy = hubCopy(useI18n().locale).uninstall;
  const option = (value: "keep" | "trash", title: string, hint: string) => (
    <button
      type="button"
      onClick={() => onPolicyChange(value)}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition",
        policy === value
          ? value === "keep"
            ? "border-primary bg-primary/8"
            : "border-warning bg-warning/8"
          : "border-border hover:bg-muted/40",
      )}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-ui text-muted-foreground">{hint}</span>
    </button>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title(appName)}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {option("keep", copy.keep, copy.keepHint)}
          {option("trash", copy.trash, copy.trashHint)}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{copy.cancel}</Button>
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
