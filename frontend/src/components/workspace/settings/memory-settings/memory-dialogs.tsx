import { useId, type Dispatch, type SetStateAction } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { formatTimeAgo } from "@/core/utils/datetime";

import {
  truncateFactPreview,
  type FactFormState,
  type MemoryFact,
  type PendingImport,
} from "./memory-helpers";

export function ClearMemoryDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t.common.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t.common.loading : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FactEditorDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  confidenceValid,
  valid,
  pending,
  onCancel,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  form: FactFormState;
  setForm: Dispatch<SetStateAction<FactFormState>>;
  confidenceValid: boolean;
  valid: boolean;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const factContentInputId = useId();
  const factCategoryInputId = useId();
  const factConfidenceInputId = useId();
  const factConfidenceHintId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t.settings.memory.editFactTitle
              : t.settings.memory.addFactTitle}
          </DialogTitle>
          <DialogDescription>
            {t.settings.memory.factEditorDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={factContentInputId}>
              {t.settings.memory.factContentLabel}
            </label>
            <Textarea
              id={factContentInputId}
              required
              value={form.content}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
              placeholder={t.settings.memory.factContentPlaceholder}
              rows={4}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={factCategoryInputId}
              >
                {t.settings.memory.factCategoryLabel}
              </label>
              <Input
                id={factCategoryInputId}
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                placeholder={t.settings.memory.factCategoryPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={factConfidenceInputId}
              >
                {t.settings.memory.factConfidenceLabel}
              </label>
              <Input
                id={factConfidenceInputId}
                required
                aria-describedby={factConfidenceHintId}
                aria-invalid={
                  form.confidence.length > 0 && !confidenceValid
                    ? true
                    : undefined
                }
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={form.confidence}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    confidence: event.target.value,
                  }))
                }
              />
              <div
                className="text-muted-foreground text-xs"
                id={factConfidenceHintId}
              >
                {t.settings.memory.factConfidenceHint}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button onClick={onSave} disabled={pending || !valid}>
            {pending ? t.common.loading : t.settings.memory.factSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFactDialog({
  fact,
  onClose,
  title,
  description,
  previewLabel,
  pending,
  onConfirm,
}: {
  fact: MemoryFact | null;
  onClose: () => void;
  title: string;
  description: string;
  previewLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open={fact !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {fact ? (
          <div className="bg-muted rounded-lg border p-3 text-sm">
            <div className="text-muted-foreground mb-1 font-medium">
              {previewLabel}
            </div>
            <p className="break-words">{truncateFactPreview(fact.content)}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t.common.loading : t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportMemoryDialog({
  pendingImport,
  onClose,
  pending,
  onConfirm,
}: {
  pendingImport: PendingImport | null;
  onClose: () => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog
      open={pendingImport !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.settings.memory.importConfirmTitle}</DialogTitle>
          <DialogDescription>
            {t.settings.memory.importConfirmDescription}
          </DialogDescription>
        </DialogHeader>
        {pendingImport ? (
          <div className="bg-muted rounded-lg border p-3 text-sm">
            <div>
              <span className="text-muted-foreground">
                {t.settings.memory.importFileLabel}:
              </span>{" "}
              {pendingImport.fileName}
            </div>
            <div>
              <span className="text-muted-foreground">
                {t.settings.memory.markdown.facts}:
              </span>{" "}
              {pendingImport.memory.facts.length}
            </div>
            <div>
              <span className="text-muted-foreground">
                {t.common.lastUpdated}:
              </span>{" "}
              {pendingImport.memory.lastUpdated
                ? formatTimeAgo(pendingImport.memory.lastUpdated)
                : "-"}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? t.common.loading : t.common.import}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
