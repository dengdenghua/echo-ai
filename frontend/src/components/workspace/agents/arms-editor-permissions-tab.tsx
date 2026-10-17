import { Loader2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { CapabilityPermission } from "@/core/agents/tool-registry-api";
import type { Translations } from "@/core/i18n/locales/types";
import { cn } from "@/lib/utils";

/** A capability permission row as computed by ``ArmsEditor``. */
export interface ArmsPermissionRow extends CapabilityPermission {
  agentSkills: string[];
  agentGranted: boolean;
  defaultGranted: boolean;
  effective: boolean;
}

export interface ArmsPermissionSummary {
  globalEnabled: number;
  agentGranted: number;
  effective: number;
  total: number;
}

interface ArmsEditorPermissionsTabProps {
  t: Translations;
  permissionsQuery: { isLoading: boolean; error: Error | null };
  permissionRows: ArmsPermissionRow[];
  permissionSummary: ArmsPermissionSummary;
  updatePermission: { isPending: boolean };
  togglePermission: (group: string, enabled: boolean) => Promise<void>;
}

/** Body of the ArmsEditor "permissions" tab (rendered inside its TabsContent). */
export function ArmsEditorPermissionsTab({
  t,
  permissionsQuery,
  permissionRows,
  permissionSummary,
  updatePermission,
  togglePermission,
}: ArmsEditorPermissionsTabProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">
            {t.armsEditor.permissionsLabel}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t.armsEditor.permissionsHint}
          </div>
        </div>
        <Badge variant="outline" className="text-xs">
          {t.armsEditor.permissionEffectiveCount(
            permissionSummary.effective,
            permissionSummary.total,
          )}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-sm border border-border bg-card/60 px-3 py-2">
          <div className="font-mono text-xs uppercase tracking-caps text-muted-foreground">
            {t.armsEditor.permissionGlobalGate}
          </div>
          <div className="mt-1 text-sm font-semibold">
            {permissionSummary.globalEnabled}/{permissionSummary.total}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-card/60 px-3 py-2">
          <div className="font-mono text-xs uppercase tracking-caps text-muted-foreground">
            {t.armsEditor.permissionAgentGrant}
          </div>
          <div className="mt-1 text-sm font-semibold">
            {permissionSummary.agentGranted}/{permissionSummary.total}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-card/60 px-3 py-2">
          <div className="font-mono text-xs uppercase tracking-caps text-muted-foreground">
            {t.armsEditor.permissionEffective}
          </div>
          <div className="mt-1 text-sm font-semibold">
            {permissionSummary.effective}/{permissionSummary.total}
          </div>
        </div>
      </div>

      {permissionsQuery.isLoading ? (
        <div className="flex items-center justify-center rounded-sm border border-border bg-card/50 p-8 text-sm text-muted-foreground">
          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
          {t.armsEditor.loading}
        </div>
      ) : permissionsQuery.error ? (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {t.armsEditor.loadFailed(
            permissionsQuery.error instanceof Error
              ? permissionsQuery.error.message
              : String(permissionsQuery.error),
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {permissionRows.map((permission) => {
            const shownAgentSkills = permission.agentSkills.slice(0, 8);
            const shownPermissionSkills = permission.skill_names.slice(0, 10);
            return (
              <div
                key={permission.id}
                className={cn(
                  "relative overflow-hidden rounded-sm border p-3 transition-colors",
                  "before:pointer-events-none before:absolute before:left-0 before:top-0 before:h-2 before:w-2 before:border-l before:border-t",
                  permission.effective
                    ? "border-primary/45 bg-primary/5 before:border-primary/70"
                    : "border-border bg-card/55 before:border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  <Switch
                    checked={permission.enabled}
                    aria-label={`全局授权 ${permission.id}`}
                    disabled={updatePermission.isPending}
                    onCheckedChange={(enabled) =>
                      void togglePermission(permission.id, enabled)
                    }
                    className="mt-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-mono text-xs font-semibold uppercase tracking-caps">
                        {permission.id}
                      </div>
                      <Badge
                        variant={permission.available ? "outline" : "secondary"}
                        className="rounded-sm text-xs"
                      >
                        {permission.effective
                          ? "当前角色可用"
                          : !permission.enabled
                            ? "全局未授权"
                            : !permission.available
                              ? "运行依赖未就绪"
                              : "当前角色未授权"}
                      </Badge>
                      <Badge
                        variant={permission.enabled ? "outline" : "secondary"}
                        className={cn(
                          "rounded-sm text-xs",
                          !permission.enabled &&
                            "border-destructive/30 text-destructive",
                        )}
                      >
                        {t.armsEditor.permissionGlobalGate}:{" "}
                        {permission.enabled
                          ? t.armsEditor.permissionEnabled
                          : t.armsEditor.permissionDisabled}
                      </Badge>
                      <Badge
                        variant={
                          permission.agentGranted ? "outline" : "secondary"
                        }
                        className={cn(
                          "rounded-sm text-xs",
                          !permission.agentGranted &&
                            "border-warning/30 text-warning",
                        )}
                      >
                        {permission.defaultGranted
                          ? t.armsEditor.permissionAgentDefault
                          : permission.agentGranted
                            ? t.armsEditor.permissionAgentGranted
                            : t.armsEditor.permissionAgentDenied}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {permission.effective
                        ? t.armsEditor.permissionEffectiveHint
                        : !permission.enabled
                          ? t.armsEditor.permissionBlockedByGlobal
                          : t.armsEditor.permissionBlockedByAgent}
                    </div>
                    {shownAgentSkills.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {shownAgentSkills.map((skill) => (
                          <Badge
                            key={skill}
                            variant="outline"
                            className="rounded-sm bg-background/70 text-xs font-mono"
                          >
                            {skill}
                          </Badge>
                        ))}
                        {permission.agentSkills.length >
                        shownAgentSkills.length ? (
                          <Badge
                            variant="secondary"
                            className="rounded-sm text-xs"
                          >
                            +
                            {permission.agentSkills.length -
                              shownAgentSkills.length}
                          </Badge>
                        ) : null}
                      </div>
                    ) : permission.defaultGranted ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t.armsEditor.permissionDefaultGrantHint}
                      </div>
                    ) : null}
                    {permission.skill_names.length > 0 ? (
                      <div className="mt-2 flex max-h-16 flex-wrap gap-1 overflow-hidden border-t border-border-default pt-2">
                        {shownPermissionSkills.map((skill) => (
                          <Badge
                            key={skill}
                            variant="outline"
                            className="rounded-sm bg-background/40 text-xs font-mono text-muted-foreground"
                          >
                            {skill}
                          </Badge>
                        ))}
                        {permission.skill_names.length >
                        shownPermissionSkills.length ? (
                          <Badge
                            variant="secondary"
                            className="rounded-sm text-xs"
                          >
                            +
                            {permission.skill_names.length -
                              shownPermissionSkills.length}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
