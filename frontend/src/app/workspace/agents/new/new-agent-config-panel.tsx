// The "能力配置" column of the new-agent name step: role, scene and
// capability-pack pickers, the resulting ARM/Skill/permission summary, and
// the reference templates. Presentational — NewAgentPage owns the state.

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import type {
  AgentCapabilityPack,
  AgentRolePreset,
  AgentScenePreset,
  AgentTemplate,
} from "./new-agent-model";

export function NewAgentConfigPanel({
  templates,
  selectedTemplate,
  selectedTemplateId,
  onSelectTemplate,
  rolePresets,
  selectedRolePresetId,
  onSelectRolePreset,
  scenePresets,
  selectedScenePresetIds,
  onToggleScenePreset,
  capabilityPacks,
  selectedCapabilityPackIds,
  onToggleCapabilityPack,
  showConfigSummary,
  selectedArms,
  selectedSkills,
  selectedPermissions,
  onApplyGuidedConfig,
}: {
  templates: AgentTemplate[];
  selectedTemplate: AgentTemplate | undefined;
  selectedTemplateId: string;
  onSelectTemplate: (template: AgentTemplate) => void;
  rolePresets: AgentRolePreset[];
  selectedRolePresetId: string;
  onSelectRolePreset: (id: string) => void;
  scenePresets: AgentScenePreset[];
  selectedScenePresetIds: string[];
  onToggleScenePreset: (id: string) => void;
  capabilityPacks: AgentCapabilityPack[];
  selectedCapabilityPackIds: string[];
  onToggleCapabilityPack: (id: string) => void;
  /** At least one scene and one capability pack are selected. */
  showConfigSummary: boolean;
  selectedArms: string[];
  selectedSkills: string[];
  selectedPermissions: string[];
  onApplyGuidedConfig: () => void;
}) {
  const { t } = useI18n();
  const agentNew = t.agents.agentNew;

  return (
    <section className="relative min-h-0 overflow-hidden border-l border-border">
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(circle_at_50%_44%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_30%),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:100%_100%,34px_34px,34px_34px]" />
      <div className="relative flex h-full min-h-0 flex-col px-5 py-7">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-primary/82">能力配置</div>
            <h2 className="mt-2 text-lg font-semibold text-foreground">
              {agentNew.buttons.autoConfig}
            </h2>
          </div>
          {selectedTemplate ? (
            <span className="flex size-9 items-center justify-center rounded-sm border border-primary/18 bg-primary/8 text-primary">
              {selectedTemplate.icon}
            </span>
          ) : null}
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]">
          <div className="rounded-sm border border-border bg-muted/10 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              角色定位
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rolePresets.map((preset) => {
                const active = preset.id === selectedRolePresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs leading-4 transition",
                      active
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border bg-muted/[0.025] text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                    onClick={() => onSelectRolePreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-muted/10 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              使用场景
            </div>
            <div className="flex flex-wrap gap-1.5">
              {scenePresets.map((preset) => {
                const active = selectedScenePresetIds.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs leading-4 transition",
                      active
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border bg-muted/[0.025] text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                    onClick={() => onToggleScenePreset(preset.id)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-muted/10 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              能力组合
            </div>
            <div className="flex flex-wrap gap-1.5">
              {capabilityPacks.map((pack) => {
                const active = selectedCapabilityPackIds.includes(pack.id);
                return (
                  <button
                    key={pack.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs leading-4 transition",
                      active
                        ? "border-primary/45 bg-primary/10 text-foreground"
                        : "border-border bg-muted/[0.025] text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                    onClick={() => onToggleCapabilityPack(pack.id)}
                  >
                    {pack.label}
                  </button>
                );
              })}
            </div>
          </div>

          {showConfigSummary ? (
            <div className="grid gap-1.5 rounded-sm border border-border bg-muted/10 p-3 text-xs leading-5 text-muted-foreground">
              <div>
                ARM:{" "}
                <span className="text-foreground">
                  {selectedArms.join(", ")}
                </span>
              </div>
              <div>
                Skill:{" "}
                <span className="text-foreground">
                  {selectedSkills.join(", ")}
                </span>
              </div>
              <div>
                {agentNew.labels.permissions}:{" "}
                <span className="text-foreground">
                  {selectedPermissions.join(" / ")}
                </span>
              </div>
            </div>
          ) : null}

          <Button
            className="h-9 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onApplyGuidedConfig}
          >
            {agentNew.buttons.generateConfig}
          </Button>

          <div className="mt-1 rounded-sm border border-border bg-muted/[0.018] p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              参考模板
            </div>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((template) => {
                const active = template.id === selectedTemplateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs leading-4 transition",
                      active
                        ? "border-primary/50 bg-primary/8 text-foreground"
                        : "border-border bg-muted/12 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                    onClick={() => onSelectTemplate(template)}
                  >
                    {template.name}
                  </button>
                );
              })}
            </div>
            {selectedTemplate ? (
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {selectedTemplate.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
