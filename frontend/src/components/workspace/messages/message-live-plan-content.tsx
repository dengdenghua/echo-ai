import type { ExecutionPlan } from "@/core/threads/types";

import { MessageContent as AIElementMessageContent } from "@/components/ai-elements/message";

import { ExecutionPlanReview } from "../execution-plan-review";
import { TaskProgressChecklist } from "../task-progress-checklist";
import { normalizeExecutionPlan } from "../execution-plan-utils";

import { useThreadValues } from "./context";

function useLiveExecutionPlan(planFromMessage: ExecutionPlan): ExecutionPlan {
  const { values } = useThreadValues();
  const livePlan = normalizeExecutionPlan(values?.execution_plan);
  return livePlan?.plan_id === planFromMessage.plan_id
    ? livePlan
    : planFromMessage;
}

/**
 * Keep the frequently-changing thread values subscription inside the two
 * message variants that actually need live plan updates. Regular transcript
 * rows must not re-render when an unrelated execution-plan value changes.
 */
export function LiveTaskChecklistContent({
  className,
  planFromMessage,
}: {
  className?: string;
  planFromMessage: ExecutionPlan;
}) {
  const plan = useLiveExecutionPlan(planFromMessage);
  return (
    <AIElementMessageContent className={className}>
      <TaskProgressChecklist plan={plan} />
    </AIElementMessageContent>
  );
}

export function LiveExecutionPlanContent({
  className,
  planFromMessage,
  threadId,
}: {
  className?: string;
  planFromMessage: ExecutionPlan;
  threadId: string;
}) {
  const plan = useLiveExecutionPlan(planFromMessage);
  return (
    <AIElementMessageContent className={className}>
      <ExecutionPlanReview plan={plan} threadId={threadId} />
    </AIElementMessageContent>
  );
}
