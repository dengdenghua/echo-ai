/**
 * 项目治理：立项批准 → 阶段授权 → 运行 → 交付验收。
 *
 * 与聊天里的 /project 审批一致：后端在 `governance` 里给出项目正在等待的决定
 * 及其指纹，这里只把它展示出来并提交用户的决定。任何一步都不会启动执行，
 * 运行仍由页头的「运行」按钮单独触发（未批准时禁用并说明原因）。
 */

import { useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  type ProjectGovernance,
  type ProjectOwnerDecision,
  useProjectOwnerDecision,
} from "@/core/projects/hooks";

import { projectConflict } from "./project-lifecycle-actions";

const RUN_BLOCK_TEXT: Record<
  NonNullable<ProjectGovernance["blocked_reason"]>,
  string
> = {
  initiation: "项目还未获批准立项，批准后才能运行。",
  phase_authorization: "本阶段还未授权，授权后才能运行。",
  owner_acceptance: "阶段交付待你验收，验收通过后才能继续推进。",
  budget: "已达到 AI 预算上限或费用回报缺失，执行已暂停。",
};

/** 运行按钮为何不可用；可运行时返回 null。 */
export function governanceRunBlock(
  governance: ProjectGovernance | undefined,
): string | null {
  const reason = governance?.blocked_reason;
  return reason ? RUN_BLOCK_TEXT[reason] : null;
}

const DECISION_ERRORS: Record<string, string> = {
  PLAN_CHANGED: "项目方案已变化，请刷新后重新确认。",
  PHASE_CHANGED: "阶段内容已变化，请刷新后重新确认。",
  DELIVERY_CHANGED: "交付内容已变化，请审阅最新版本后再验收。",
  PROJECT_NOT_STAFFED: "项目还没有工作群成员，请先进入项目群添加成员。",
  PHASE_MEMBERS_UNAVAILABLE: "本阶段没有可授权的成员。",
  DELIVERY_EMPTY: "有任务没有交付内容，不能只凭完成状态验收。",
};

function budgetText(value: number | null | undefined): string {
  return value === null || value === undefined ? "未设置" : `$${value}`;
}

export function ProjectGovernancePanel({
  projectId,
  governance,
  onChanged,
}: {
  projectId: string;
  governance: ProjectGovernance | undefined;
  onChanged: () => void;
}) {
  const decide = useProjectOwnerDecision();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [budget, setBudget] = useState("");
  if (!governance?.blocked_reason) return null;
  const { initiation, phase, acceptance, blocked_reason } = governance;

  const submit = async (
    decision: ProjectOwnerDecision,
    prompt: { title: string; description: string; confirmLabel: string },
    success: string,
  ) => {
    const ok = await confirm({ ...prompt, cancelLabel: "返回" });
    if (!ok) return;
    try {
      await decide.mutateAsync({ projectId, decision });
      toast.success(success);
      onChanged();
    } catch (error) {
      const code = projectConflict(error)?.code ?? "";
      toast.error(DECISION_ERRORS[code] ?? "操作失败，请稍后重试。");
    }
  };

  const approveInitiation = () => {
    const raw = budget.trim();
    const cap = raw === "" ? undefined : Number(raw);
    if (cap !== undefined && (!Number.isFinite(cap) || cap < 0)) {
      toast.error("AI 预算上限需为不小于 0 的美元金额。");
      return;
    }
    void submit(
      {
        kind: "initiation",
        fingerprint: initiation.fingerprint,
        aiBudgetUsd: cap,
      },
      {
        title: "批准立项",
        description:
          "批准后项目按阶段推进：每个阶段执行前仍需授权，阶段交付需你验收。批准本身不会执行任务，也不授权付款或聘用真人。",
        confirmLabel: "批准立项",
      },
      "立项已批准",
    );
  };

  return (
    <div
      role="region"
      aria-label="项目审批"
      className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <ShieldCheckIcon className="size-4 text-amber-600" />
        {blocked_reason === "initiation"
          ? initiation.state === "legacy"
            ? "待补充立项批准（旧项目首次运行）"
            : "待立项批准"
          : blocked_reason === "phase_authorization"
            ? "本阶段待授权"
            : blocked_reason === "owner_acceptance"
              ? "交付待你验收"
              : "执行已暂停"}
      </div>
      <p className="text-xs text-muted-foreground">
        {RUN_BLOCK_TEXT[blocked_reason]}
      </p>

      {blocked_reason === "initiation" && (
        <div className="space-y-2">
          {initiation.proposed_phase_agents.length > 0 && (
            <p className="text-xs">
              阶段成员（来自项目群）：
              {initiation.proposed_phase_agents.join("、")}
            </p>
          )}
          {!initiation.staffing_available && (
            <p className="text-xs text-destructive">
              项目还没有工作群成员，请先进入项目群添加成员。
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="AI 预算上限（美元，可选）"
              placeholder="AI 预算上限（美元，可选）"
              inputMode="decimal"
              className="h-8 w-56 text-xs"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
            <Button
              size="sm"
              className="text-xs"
              disabled={decide.isPending || !initiation.staffing_available}
              onClick={approveInitiation}
            >
              批准立项
            </Button>
          </div>
        </div>
      )}

      {blocked_reason === "phase_authorization" && phase && (
        <div className="space-y-2 text-xs">
          <p>
            阶段：{phase.name}；成员：{phase.phase_agents.join("、") || "无"}
            ；AI 预算上限：{budgetText(phase.ai_budget_usd)}
          </p>
          <Button
            size="sm"
            className="text-xs"
            disabled={decide.isPending || phase.phase_agents.length === 0}
            onClick={() =>
              void submit(
                {
                  kind: "phase",
                  milestoneId: phase.milestone_id,
                  fingerprint: phase.fingerprint,
                },
                {
                  title: "授权本阶段",
                  description: `授权「${phase.name}」由 ${phase.phase_agents.join("、")} 执行。仅授权本阶段；验收后下一阶段另行授权。`,
                  confirmLabel: "授权本阶段",
                },
                "本阶段已授权，可以运行",
              )
            }
          >
            授权本阶段
          </Button>
        </div>
      )}

      {blocked_reason === "owner_acceptance" &&
        acceptance.map((item) => (
          <div key={item.milestone_id} className="space-y-1.5 text-xs">
            <p>阶段：{item.name}</p>
            {item.success_criteria.length > 0 && (
              <ul className="list-disc pl-4 text-muted-foreground">
                {item.success_criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            )}
            {!item.has_content && (
              <p className="text-destructive">
                有任务没有交付内容，需补充后再验收。
              </p>
            )}
            <Button
              size="sm"
              className="text-xs"
              disabled={decide.isPending || !item.has_content}
              onClick={() =>
                void submit(
                  {
                    kind: "acceptance",
                    milestoneId: item.milestone_id,
                    fingerprint: item.fingerprint,
                  },
                  {
                    title: "验收本阶段交付",
                    description: `请对照验收标准审阅「${item.name}」的任务交付。通过仅记录验收，不自动启动下一阶段。`,
                    confirmLabel: "验收通过",
                  },
                  "阶段验收已记录",
                )
              }
            >
              验收通过
            </Button>
          </div>
        ))}
      {confirmDialog}
    </div>
  );
}
