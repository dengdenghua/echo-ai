import {
  apiDelete,
  apiGet,
  apiPost,
  type ApiFailure,
} from "@/core/api/request";

export type RuleEffect = "allow" | "deny";

export interface ApprovalRule {
  effect: RuleEffect;
  tool: string;
  args_contains: string;
  reason: string;
}

export interface PolicyResponse {
  rules: ApprovalRule[];
}

export interface NewRuleInput {
  effect: RuleEffect;
  tool: string;
  args_contains?: string;
  reason?: string;
}

/** ``"<label>: <status>[ <body>]"`` — this module's write-error wording. */
function failedWithBody(label: string) {
  return (failure: ApiFailure): string =>
    `${label}: ${failure.status}${failure.text ? ` ${failure.text}` : ""}`;
}

export async function listPermissionRules(): Promise<ApprovalRule[]> {
  const data = await apiGet("/api/permissions", {
    errorMessage: (failure) =>
      `Failed to load permission rules: ${failure.statusText}`,
  });
  return data.rules ?? [];
}

export async function addPermissionRule(
  rule: NewRuleInput,
): Promise<ApprovalRule[]> {
  const body = {
    effect: rule.effect,
    tool: rule.tool,
    args_contains: rule.args_contains ?? "",
    reason: rule.reason ?? "",
  };
  const data = await apiPost("/api/permissions/rules", {
    body,
    errorMessage: failedWithBody("Failed to add rule"),
  });
  return data.rules ?? [];
}

export async function deletePermissionRule(
  index: number,
): Promise<ApprovalRule[]> {
  const data = await apiDelete("/api/permissions/rules/{index}", {
    path: { index },
    errorMessage: failedWithBody("Failed to delete rule"),
  });
  return data.rules ?? [];
}

export async function movePermissionRule(
  fromIndex: number,
  toIndex: number,
): Promise<ApprovalRule[]> {
  const data = await apiPost("/api/permissions/rules/{index}/move", {
    path: { index: fromIndex },
    body: { to: toIndex },
    errorMessage: failedWithBody("Failed to move rule"),
  });
  return data.rules ?? [];
}
