import type {
  Health,
  ProjectActionSpec,
  ProjectTaskReadModel,
  PmReport,
  ProjectAssetView,
  ProjectDecisionView,
} from "./project-workbench-types";

export const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  pending: "待开始",
  active: "进行中",
  in_progress: "进行中",
  running: "进行中",
  ready: "可执行",
  blocked: "已阻塞",
  done: "已完成",
  completed: "已完成",
  failed: "失败",
  rejected: "未通过",
};

export const STATUS_TONE: Record<string, string> = {
  planning: "border-border-default bg-muted text-muted-foreground",
  pending: "border-border-default bg-muted text-muted-foreground",
  ready: "border-border bg-foreground/5 text-foreground",
  active: "border-core/25 bg-core/10 text-core",
  in_progress: "border-core/25 bg-core/10 text-core",
  running: "border-core/25 bg-core/10 text-core",
  blocked: "border-breach/25 bg-breach/10 text-breach",
  done: "border-core/25 bg-core/10 text-core",
  completed: "border-core/25 bg-core/10 text-core",
  failed: "border-breach/25 bg-breach/10 text-breach",
  rejected: "border-breach/25 bg-breach/10 text-breach",
};

export const HEALTH_LABEL: Record<Health, string> = {
  on_track: "正常",
  at_risk: "有风险",
  overdue: "已逾期",
  blocked: "阻塞",
  completed: "完成",
};

export const HEALTH_TONE: Record<Health, string> = {
  on_track: "border-core/25 bg-core/10 text-core",
  at_risk: "border-warning/25 bg-warning/10 text-warning",
  overdue: "border-breach/25 bg-breach/10 text-breach",
  blocked: "border-breach/25 bg-breach/10 text-breach",
  completed: "border-core/25 bg-core/10 text-core",
};

export const HEALTH_DOT: Record<Health, string> = {
  on_track: "bg-core",
  at_risk: "bg-warning",
  overdue: "bg-breach/60",
  blocked: "bg-breach",
  completed: "bg-core/50",
};

export const PRIORITY_TONE: Record<string, string> = {
  P0: "border-warning/25 bg-warning/10 text-warning",
  P1: "border-border bg-foreground/5 text-foreground",
  P2: "border-border-default bg-muted/70 text-muted-foreground",
  P3: "border-border-default bg-muted/40 text-muted-foreground/80",
};

const PROJECT_ACTION_LABEL: Record<string, string> = {
  run: "开始推进",
  tick: "推进一步",
  recover: "恢复阻塞",
  recover_and_run: "恢复并推进",
  inspect: "检查状态",
  report: "生成报告",
};

const TASK_ACTION_LABEL: Record<string, string> = {
  reset: "重新开始",
  complete: "标记完成",
  skip: "跳过事项",
  reassign: "重新指派",
};

export const ACTIVE_TASK_STATUSES = new Set(["pending", "ready", "running"]);
export const ATTENTION_TASK_STATUSES = new Set([
  "blocked",
  "failed",
  "rejected",
]);

/**
 * A node a real person has to do — or whose AI draft a person has to sign off.
 * These never run on an agent, so the workbench must not dress them up as one:
 * showing a bot avatar (or an AI role name) is how a human step silently reads
 * as machine work. swarm/cluster keep rendering their raw id, as before.
 */
export const HUMAN_TEAM_MODES = new Set(["human", "hybrid"]);
export const TEAM_MODE_LABEL: Record<string, string> = {
  human: "真人执行",
  hybrid: "人机协同",
};

/**
 * Project OS serializes progress as a ratio (0–1). Older fixtures and third
 * party projections may already send a percentage; accepting both keeps the
 * workbench resilient without ever rendering values outside 0–100.
 */
export function normalizeProjectProgress(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const percentage = parsed <= 1 ? parsed * 100 : parsed;
  return Math.min(100, Math.round(percentage));
}

export function fmtDate(value: string | undefined | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

export function fmtDecisionTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatEstimate(value: number | undefined): string {
  if (!Number.isFinite(value)) return "—";
  return `${value} 天`;
}

export function displayActionLabel(
  spec: ProjectActionSpec,
  task = false,
): string {
  return (
    (task
      ? TASK_ACTION_LABEL[spec.action]
      : PROJECT_ACTION_LABEL[spec.action]) ??
    spec.label ??
    spec.action
  );
}

export function safeRiskDetail(risk: PmReport["risks"][number]): string {
  if (risk.type === "milestone") {
    return risk.health === "overdue"
      ? "里程碑已经逾期，请重新评估排期。"
      : "里程碑存在阻塞，请检查相关事项状态。";
  }
  if (risk.health === "overdue") {
    return risk.task
      ? `${risk.task}已逾期，请重新评估排期。`
      : "事项已逾期，请重新评估排期。";
  }
  if (["blocked", "failed", "rejected"].includes(risk.health)) {
    return risk.task
      ? `${risk.task}执行失败或受阻，请检查执行环境后重试。`
      : "事项执行失败或受阻，请检查执行环境后重试。";
  }
  return risk.task
    ? `${risk.task}的状态需要关注。`
    : "事项状态需要关注，请检查详情。";
}

export function uniqueProjectRisks(pm: PmReport | null): PmReport["risks"] {
  if (!pm) return [];
  const blockerNames = new Set(pm.blockers ?? []);
  return (pm.risks ?? []).filter(
    (risk) =>
      !(
        risk.type === "milestone" &&
        risk.milestone &&
        blockerNames.has(risk.milestone)
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyOutput(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function firstString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function projectDecisionViews(value: unknown): ProjectDecisionView[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((candidate, index): ProjectDecisionView | null => {
      if (!isRecord(candidate)) return null;
      const explicitTitle = firstString(candidate, ["title", "name"]);
      const decision = firstString(candidate, ["decision", "content"]);
      const summary = firstString(candidate, ["summary", "description"]);
      const title = explicitTitle ?? summary ?? decision;
      if (!title) return null;

      const body = decision ?? (explicitTitle ? summary : undefined);
      const createdAt = firstString(candidate, [
        "created_at",
        "recorded_at",
        "timestamp",
      ]);
      return {
        id:
          firstString(candidate, ["id"]) ??
          `decision:${createdAt ?? title}:${index}`,
        title,
        body: body && body !== title ? body : undefined,
        actor: firstString(candidate, ["actor", "created_by", "author"]),
        milestoneId: firstString(candidate, ["milestone_id"]),
        createdAt,
      };
    })
    .filter((decision): decision is ProjectDecisionView => decision !== null)
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : NaN;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : NaN;
      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
      if (Number.isNaN(leftTime)) return 1;
      if (Number.isNaN(rightTime)) return -1;
      return rightTime - leftTime;
    });
}

export function isExternalUrl(
  value: string | undefined,
): value is `http://${string}` | `https://${string}` {
  return !!value && /^https?:\/\//i.test(value);
}

function looksLikePath(value: string | undefined): value is string {
  if (!value || isExternalUrl(value)) return false;
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /\.[a-z0-9]{1,8}(?:[#?].*)?$/i.test(value)
  );
}

function shortOutput(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 140
      ? `${normalized.slice(0, 140)}…`
      : normalized;
  }
  if (isRecord(value)) {
    return firstString(value, ["summary", "description", "message", "result"]);
  }
  return undefined;
}

export function assetsFromTask(task: ProjectTaskReadModel): ProjectAssetView[] {
  if (task.status !== "done" || !nonEmptyOutput(task.output)) return [];

  const rawOutput = task.output;
  const candidates = (() => {
    if (Array.isArray(rawOutput)) return rawOutput;
    if (isRecord(rawOutput)) {
      for (const key of ["artifacts", "files", "outputs"]) {
        const nested = rawOutput[key];
        if (Array.isArray(nested) && nested.length > 0) return nested;
      }
    }
    return [rawOutput];
  })();

  return candidates
    .filter(nonEmptyOutput)
    .map((candidate, index): ProjectAssetView => {
      const record = isRecord(candidate) ? candidate : {};
      const path =
        firstString(record, ["path", "file_path", "filename"]) ??
        (typeof candidate === "string" && looksLikePath(candidate)
          ? candidate
          : undefined);
      const url =
        firstString(record, ["url", "href"]) ??
        (typeof candidate === "string" && isExternalUrl(candidate)
          ? candidate
          : undefined);
      const fallbackName =
        candidates.length > 1
          ? `${task.goal || task.id} · ${index + 1}`
          : `${task.goal || task.id} · 交付物`;

      return {
        id: `${task.id}:output:${index}`,
        name:
          firstString(record, ["name", "title", "filename"]) ??
          (path ? path.split("/").filter(Boolean).at(-1) : undefined) ??
          fallbackName,
        kind: firstString(record, ["kind", "type"]) ?? task.type,
        path,
        url,
        summary: shortOutput(candidate) ?? "结构化交付结果",
        task_id: task.id,
        milestone_id: task.milestone_id,
        sourceTask: task.goal || task.id,
      };
    });
}
