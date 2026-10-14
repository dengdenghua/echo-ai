import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isApiErrorStatus } from "@/core/api/request";
import type { OrgCopy } from "@/core/organizations/copy";

type Operation = {
  title: string;
  description: string;
  run: () => Promise<unknown>;
  destructive?: boolean;
  confirmLabel?: string;
};
export function orgError(error: unknown, copy: OrgCopy): string {
  if (isApiErrorStatus(error, 401, 403, 404)) return copy.forbidden;
  if (isApiErrorStatus(error, 409)) return copy.conflict;
  return error instanceof Error ? error.message : copy.failed;
}
export function useOrgAction(copy: OrgCopy, reload: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const run = async (task: () => Promise<unknown>) => {
    if (!live.current || pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
      if (!live.current) return false;
      await reload();
      return live.current;
    } catch (failure) {
      if (live.current) setError(orgError(failure, copy));
      return false;
    } finally {
      pending.current = false;
      if (live.current) {
        setBusy(false);
        setOperation(null);
      }
    }
  };
  return {
    busy,
    error,
    run,
    request: (next: Operation) => {
      if (live.current && !pending.current) {
        setError("");
        setOperation(next);
      }
    },
    dialog: (
      <ConfirmDialog
        open={operation !== null}
        title={operation?.title ?? ""}
        description={operation?.description}
        confirmLabel={
          operation?.confirmLabel ??
          (operation?.destructive === false ? copy.save : copy.delete)
        }
        cancelLabel={copy.cancel}
        destructive={operation?.destructive ?? true}
        pending={busy}
        onOpenChange={(open) => {
          if (!open && !pending.current) setOperation(null);
        }}
        onConfirm={() => {
          if (operation) void run(operation.run);
        }}
      />
    ),
  };
}
export type OrgAction = ReturnType<typeof useOrgAction>;
