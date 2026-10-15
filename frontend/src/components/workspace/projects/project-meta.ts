/**
 * 项目管理控制台的共享展示元数据。
 *
 * 页面与子组件都从这里取标签/配色，避免同一个健康度在两处出现不同说法
 * （此前 `STATUS_LABEL` 与 `HEALTH_LABEL` 只在 page.tsx 内部重复定义）。
 */

import type { ProjectHealth } from "@/core/projects/portfolio";

export const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  running: "进行中",
  blocked: "已阻塞",
  done: "已完成",
  // 后端引擎从不自行把项目置为 failed（执行问题一律阻塞待恢复），
  // 这个终态只来自用户「取消项目」。
  failed: "已终止",
};

export const HEALTH_LABEL: Record<string, string> = {
  on_track: "正常",
  at_risk: "有风险",
  overdue: "已逾期",
  blocked: "阻塞",
  completed: "完成",
};

export const HEALTH_TONE: Record<ProjectHealth, string> = {
  on_track: "bg-core/15 text-core border-core/30",
  at_risk: "bg-warning/15 text-warning border-warning/30",
  overdue: "bg-breach/15 text-breach border-breach/30",
  blocked: "bg-breach/15 text-breach border-breach/30",
  completed: "bg-core/15 text-core border-core/30",
};

export const HEALTH_DOT: Record<ProjectHealth, string> = {
  on_track: "bg-core",
  at_risk: "bg-warning",
  overdue: "bg-breach/60",
  blocked: "bg-breach",
  completed: "bg-core/50",
};

export const HEALTH_FILL: Record<ProjectHealth, string> = {
  on_track: "var(--echo-core)",
  at_risk: "var(--echo-warning)",
  overdue: "color-mix(in oklab, var(--echo-breach) 60%, transparent)",
  blocked: "var(--echo-breach)",
  completed: "color-mix(in oklab, var(--echo-core) 50%, transparent)",
};

/** 甘特条：底色（计划区间）与进度条（已完成部分）。 */
export const HEALTH_BAR_TRACK: Record<ProjectHealth, string> = {
  on_track: "bg-core/25",
  at_risk: "bg-warning/25",
  overdue: "bg-breach/20",
  blocked: "bg-breach/30",
  completed: "bg-core/15",
};

export const HEALTH_BAR_FILL: Record<ProjectHealth, string> = {
  on_track: "bg-core",
  at_risk: "bg-warning",
  overdue: "bg-breach/60",
  blocked: "bg-breach",
  completed: "bg-core/50",
};

export const HEALTH_LABEL_EN: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  overdue: "Overdue",
  blocked: "Blocked",
  completed: "Completed",
};

export const STATUS_TONE: Record<string, string> = {
  planning: "bg-muted text-muted-foreground",
  running: "bg-core/15 text-core",
  blocked: "bg-breach/15 text-breach",
  done: "bg-core/15 text-core",
  failed: "bg-breach/15 text-breach",
};

export const PRIORITY_TONE: Record<string, string> = {
  P0: "bg-warning/15 text-warning",
  P1: "bg-foreground/10 text-foreground",
  P2: "bg-muted text-muted-foreground",
  P3: "bg-muted text-muted-foreground",
};

export function statusLabel(status: string | undefined): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status;
}

export function healthLabel(health: string): string {
  return HEALTH_LABEL[health] ?? health;
}

export function fmtDate(value: string | undefined | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function fmtDateTime(value: string | undefined | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 「已逾期 3 天」/「今天到期」/「还剩 2 天」/「未排期」 */
export function duePhrase(daysLeft: number | null): string {
  if (daysLeft === null) return "未排期";
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天到期";
  if (daysLeft === 1) return "明天到期";
  return `还剩 ${daysLeft} 天`;
}
