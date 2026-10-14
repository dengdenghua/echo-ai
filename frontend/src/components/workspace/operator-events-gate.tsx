import { ActivityIcon } from "lucide-react";
import type { ReactNode } from "react";

import { canAccessOperatorControlPlane } from "@/core/auth/control-plane-access";
import { useOptionalAuth } from "@/providers/AuthProvider";

/**
 * Live run events (``/api/stream``) are served to administrators and
 * operators only; the server answers anyone else with 403 and the SSE
 * client would keep retrying. Render the panels for them, and one calm
 * explanation for everyone else (``quiet`` gates render nothing extra).
 */
export function OperatorEventsGate({
  children,
  quiet = false,
}: {
  children: ReactNode;
  quiet?: boolean;
}) {
  const auth = useOptionalAuth();
  const allowed =
    !auth ||
    canAccessOperatorControlPlane(auth.authStatus ?? null, auth.user ?? null);
  if (allowed) return <>{children}</>;
  if (quiet) return null;
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/15 px-6 text-center">
      <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
        <ActivityIcon className="size-5" />
      </div>
      <div>
        <div className="text-sm font-semibold">实时事件流由管理员查看</div>
        <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
          运行复盘、子智能体调用和日志流需要管理员或运维权限。你自己的任务过程和结果在对话里都能看到。
        </div>
      </div>
    </div>
  );
}
